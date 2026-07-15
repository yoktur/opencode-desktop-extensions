fn main() {
    #[cfg(windows)]
    winresource::WindowsResource::new()
        .set_icon("assets/icon.ico")
        .set("FileDescription", "OpenCode Desktop Extensions")
        .set("ProductName", "OCDX")
        .compile()
        .expect("failed to embed the OCDX launcher resources");
}
