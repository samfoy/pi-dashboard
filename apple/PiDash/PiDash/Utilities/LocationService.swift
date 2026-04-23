import CoreLocation

@MainActor
final class LocationService: NSObject {
    static let shared = LocationService()

    private let manager = CLLocationManager()
    private var locationContinuation: CheckedContinuation<CLLocation, Error>?

    private override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    // MARK: - Authorization

    func requestAuthorization() async {
        guard manager.authorizationStatus == .notDetermined else { return }
        manager.requestWhenInUseAuthorization()
        // Give the system a moment to present the prompt
        try? await Task.sleep(nanoseconds: 500_000_000)
    }

    // MARK: - Fetch current location summary

    func fetchLocationSummary() async -> String {
        let status = manager.authorizationStatus
        guard status == .authorizedWhenInUse || status == .authorizedAlways else {
            if status == .notDetermined {
                manager.requestWhenInUseAuthorization()
            }
            return "[Location unavailable — please grant location access in Settings]"
        }

        do {
            let location = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<CLLocation, Error>) in
                self.locationContinuation = continuation
                self.manager.requestLocation()
            }

            let address = await reverseGeocode(location)
            let lat = String(format: "%.5f", location.coordinate.latitude)
            let lon = String(format: "%.5f", location.coordinate.longitude)
            let accuracy = Int(location.horizontalAccuracy)

            var lines = ["[Current Location]"]
            if !address.isEmpty {
                lines.append(address)
            }
            lines.append("Coordinates: \(lat), \(lon) (±\(accuracy) m)")

            return lines.joined(separator: "\n")
        } catch {
            return "[Location error: \(error.localizedDescription)]"
        }
    }

    // MARK: - Reverse geocode

    private func reverseGeocode(_ location: CLLocation) async -> String {
        do {
            let placemarks = try await CLGeocoder().reverseGeocodeLocation(location)
            guard let pm = placemarks.first else { return "" }

            var parts: [String] = []
            if let name = pm.name, !name.isEmpty { parts.append(name) }
            if let locality = pm.locality { parts.append(locality) }
            if let adminArea = pm.administrativeArea { parts.append(adminArea) }
            if let country = pm.country { parts.append(country) }

            return parts.joined(separator: ", ")
        } catch {
            return ""
        }
    }
}

// MARK: - CLLocationManagerDelegate

extension LocationService: CLLocationManagerDelegate {
    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.first else { return }
        Task { @MainActor in
            self.locationContinuation?.resume(returning: location)
            self.locationContinuation = nil
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in
            self.locationContinuation?.resume(throwing: error)
            self.locationContinuation = nil
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        // No-op — handled by callers checking authorizationStatus
    }
}
