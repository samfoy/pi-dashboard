import Contacts
import Foundation

// MARK: - ContactsService

final class ContactsService {
    static let shared = ContactsService()
    private let store = CNContactStore()

    private init() {}

    // MARK: - Authorization

    func requestAuthorization() async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            store.requestAccess(for: .contacts) { granted, error in
                if let error = error {
                    continuation.resume(throwing: error)
                } else if !granted {
                    continuation.resume(throwing: ContactsError.denied)
                } else {
                    continuation.resume(returning: ())
                }
            }
        }
    }

    // MARK: - Fetch Contacts

    func fetchContacts() async -> String {
        let status = CNContactStore.authorizationStatus(for: .contacts)
        guard status == .authorized else {
            return "[Contacts — Access not granted]"
        }

        let keys: [CNKeyDescriptor] = [
            CNContactGivenNameKey as CNKeyDescriptor,
            CNContactFamilyNameKey as CNKeyDescriptor,
            CNContactPhoneNumbersKey as CNKeyDescriptor,
            CNContactEmailAddressesKey as CNKeyDescriptor
        ]

        return await Task.detached(priority: .userInitiated) { [store] in
            var contacts: [CNContact] = []
            let request = CNContactFetchRequest(keysToFetch: keys)
            request.sortOrder = .userDefault

            do {
                try store.enumerateContacts(with: request) { contact, stop in
                    contacts.append(contact)
                    if contacts.count >= 200 { stop.pointee = true }
                }
            } catch {
                return "[Contacts — Error fetching: \(error.localizedDescription)]"
            }

            guard !contacts.isEmpty else {
                return "[Contacts — No contacts found]"
            }

            let limit = 100
            let shown = Array(contacts.prefix(limit))
            let remaining = contacts.count - shown.count

            var lines: [String] = []
            for contact in shown {
                let name = [contact.givenName, contact.familyName]
                    .filter { !$0.isEmpty }
                    .joined(separator: " ")
                let displayName = name.isEmpty ? "(No Name)" : name
                let phone = contact.phoneNumbers.first?.value.stringValue ?? ""
                let email = contact.emailAddresses.first?.value as String? ?? ""

                var parts: [String] = [displayName]
                if !phone.isEmpty { parts.append(phone) }
                if !email.isEmpty { parts.append(email) }
                lines.append("• " + parts.joined(separator: " | "))
            }

            if remaining > 0 {
                lines.append("… and \(remaining) more contact\(remaining == 1 ? "" : "s") not shown")
            }

            let header = "[Contacts — \(contacts.count) total, showing \(shown.count)]"
            return header + "\n" + lines.joined(separator: "\n")
        }.value
    }
}

// MARK: - Errors

enum ContactsError: LocalizedError {
    case denied

    var errorDescription: String? {
        switch self {
        case .denied: return "Contacts access denied."
        }
    }
}
