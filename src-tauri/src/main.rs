use rust_embed::RustEmbed;
use serde::Serialize;
use serialport::SerialPort;
use std::{io::{Read, Write}, sync::Mutex, thread, time::Duration};
use tauri::{WebviewUrl, WebviewWindowBuilder};
use tiny_http::{Header, Response, Server, StatusCode};

#[derive(RustEmbed)]
#[folder = "../www/"]
struct WebAssets;

struct SerialState(Mutex<Option<Box<dyn SerialPort>>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PortChoice { port_name: String, label: String }

#[tauri::command]
fn serial_ports() -> Result<Vec<PortChoice>, String> {
    serialport::available_ports().map_err(|error| error.to_string()).map(|ports| ports.into_iter().map(|port| {
        let detail = match port.port_type {
            serialport::SerialPortType::BluetoothPort => "Bluetooth".to_string(),
            serialport::SerialPortType::UsbPort(info) => info.product.unwrap_or_else(|| "USB serial".into()),
            _ => "Serial port".to_string(),
        };
        PortChoice { label: format!("{} — {}", port.port_name, detail), port_name: port.port_name }
    }).collect())
}

#[tauri::command]
fn serial_open(port_name: String, state: tauri::State<SerialState>) -> Result<(), String> {
    let port = serialport::new(&port_name, 115_200)
        .data_bits(serialport::DataBits::Eight).stop_bits(serialport::StopBits::One)
        .parity(serialport::Parity::None).flow_control(serialport::FlowControl::None)
        .timeout(Duration::from_millis(150)).open()
        .map_err(|error| format!("Could not open {port_name}: {error}"))?;
    *state.0.lock().map_err(|_| "Serial connection lock failed".to_string())? = Some(port);
    Ok(())
}

#[tauri::command]
fn serial_write(data: Vec<u8>, state: tauri::State<SerialState>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|_| "Serial connection lock failed".to_string())?;
    let port = guard.as_mut().ok_or_else(|| "No Perdix serial port is open".to_string())?;
    port.write_all(&data).map_err(|error| error.to_string())?;
    port.flush().map_err(|error| error.to_string())
}

#[tauri::command]
fn serial_read(state: tauri::State<SerialState>) -> Result<Vec<u8>, String> {
    let mut guard = state.0.lock().map_err(|_| "Serial connection lock failed".to_string())?;
    let port = guard.as_mut().ok_or_else(|| "No Perdix serial port is open".to_string())?;
    let mut buffer = vec![0u8; 1024];
    match port.read(&mut buffer) {
        Ok(count) => { buffer.truncate(count); Ok(buffer) }
        Err(error) if error.kind() == std::io::ErrorKind::TimedOut => Ok(Vec::new()),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn serial_close(state: tauri::State<SerialState>) -> Result<(), String> {
    *state.0.lock().map_err(|_| "Serial connection lock failed".to_string())? = None;
    Ok(())
}

#[derive(Serialize)]
struct SaveResult { canceled: bool, bytes: usize }

#[tauri::command]
fn save_json(filename: String, data: String) -> Result<SaveResult, String> {
    if data.len() > 250 * 1024 * 1024 { return Err("Invalid export data".into()); }
    let selected = rfd::FileDialog::new().set_file_name(&filename).add_filter("JSON files", &["json"]).save_file();
    let Some(path) = selected else { return Ok(SaveResult { canceled: true, bytes: 0 }); };
    std::fs::write(path, data.as_bytes()).map_err(|error| error.to_string())?;
    Ok(SaveResult { canceled: false, bytes: data.len() })
}

fn start_web_server() -> Result<u16, String> {
    let server = Server::http("127.0.0.1:0").map_err(|error| error.to_string())?;
    let port = server.server_addr().to_ip().ok_or_else(|| "No local server address".to_string())?.port();
    thread::spawn(move || for request in server.incoming_requests() {
        let requested = request.url().split('?').next().unwrap_or("/").trim_start_matches('/');
        let asset_name = if requested.is_empty() { "index.html" } else { requested };
        if asset_name.contains("..") { let _ = request.respond(Response::empty(StatusCode(403))); continue; }
        match WebAssets::get(asset_name) {
            Some(asset) => {
                let mime = mime_guess::from_path(asset_name).first_or_octet_stream().to_string();
                let response = Response::from_data(asset.data.into_owned())
                    .with_header(Header::from_bytes("Content-Type", mime).unwrap())
                    .with_header(Header::from_bytes("Cache-Control", "no-store").unwrap());
                let _ = request.respond(response);
            }
            None => { let _ = request.respond(Response::empty(StatusCode(404))); }
        }
    });
    Ok(port)
}

fn main() {
    let port = start_web_server().expect("SeaBirds local web server failed");
    tauri::Builder::default()
        .manage(SerialState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![serial_ports, serial_open, serial_write, serial_read, serial_close, save_json])
        .setup(move |app| {
            let url = url::Url::parse(&format!("http://localhost:{port}/index.html"))?;
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("SeaBirds").inner_size(1440.0, 920.0).min_inner_size(900.0, 640.0).build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running SeaBirds");
}
