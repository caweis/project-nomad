

export function getServiceLink(ui_location: string): string {
    // "https:8500" / "http:8090" — a scheme plus a bare port, used for services
    // that must be reached over a specific scheme (MeshCore Web serves HTTPS on
    // 8500 behind a self-signed cert). Handle this BEFORE new URL(), which would
    // mis-parse "https:8500" as host "8500" and return a dead link. Build the URL
    // against the current host so it works via localhost, nomad.local, or LAN IP.
    const schemePort = ui_location.match(/^(https?):(\d+)$/i);
    if (schemePort) {
        return `${schemePort[1].toLowerCase()}://${window.location.hostname}:${schemePort[2]}`;
    }

    // Check if the ui location is a valid URL
    try {
        const url = new URL(ui_location);
        // If it is a valid URL, return it as is
        return url.href;
    } catch (e) {
        // If it fails, it means it's not a valid URL
    }

    // Check if the ui location is a port number
    const parsedPort = parseInt(ui_location, 10);
    if (!isNaN(parsedPort)) {
        // If it's a port number, return a link to the service on that port
        return `http://${window.location.hostname}:${parsedPort}`;
    }

    const pathPattern = /^\/.+/;
    if (pathPattern.test(ui_location)) {
        // If it starts with a slash, treat it as a full path
        return ui_location;
    }

    return `/${ui_location}`;
}