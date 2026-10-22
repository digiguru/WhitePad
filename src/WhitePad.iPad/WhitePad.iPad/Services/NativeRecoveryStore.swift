import Foundation
import Security
import CryptoKit

struct NativeSessionRecord: Codable {
    let studentId: String
    let token: String
    let name: String
    let created: Date
}
// Credentials are separate from the board journal and never placed in links or logs.
enum NativeRecoveryStore {
    static func key(_ text: String) -> String { SHA256.hash(data:Data(text.utf8)).map{String(format:"%02x",$0)}.joined() }
    static func session(_ key: String) throws -> NativeSessionRecord? {
        let query: [String:Any] = [kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:"WhitePad.WebRTC",kSecAttrAccount as String:key,kSecReturnData as String:true]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary,&result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw WhitePadError.connectionFailed("Secure recovery unavailable") }
        let record = try JSONDecoder().decode(NativeSessionRecord.self,from:data)
        if Date().timeIntervalSince(record.created) >= 86400 {
            let delete: [String:Any] = [kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:"WhitePad.WebRTC",kSecAttrAccount as String:key]
            SecItemDelete(delete as CFDictionary)
            return nil
        }
        return record
    }
    static func saveSession(_ record: NativeSessionRecord, key: String) throws {
        let query: [String:Any] = [kSecClass as String:kSecClassGenericPassword,kSecAttrService as String:"WhitePad.WebRTC",kSecAttrAccount as String:key]
        let data = try JSONEncoder().encode(record)
        let status = SecItemUpdate(query as CFDictionary,[kSecValueData as String:data] as CFDictionary)
        if status == errSecItemNotFound {
            var add = query; add[kSecValueData as String] = data
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            guard SecItemAdd(add as CFDictionary,nil) == errSecSuccess else { throw WhitePadError.connectionFailed("Secure recovery unavailable") }
        } else if status != errSecSuccess { throw WhitePadError.connectionFailed("Secure recovery unavailable") }
    }
    static func directory() throws -> URL {
        let root = try FileManager.default.url(for:.applicationSupportDirectory,in:.userDomainMask,appropriateFor:nil,create:true).appendingPathComponent("WhitePadBoards",isDirectory:true)
        try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true)
        // Seven-day retention. No board is uploaded as a cloud backup.
        for file in (try? FileManager.default.contentsOfDirectory(at:root,includingPropertiesForKeys:[.contentModificationDateKey])) ?? [] {
            if let date = try? file.resourceValues(forKeys:[.contentModificationDateKey]).contentModificationDate, Date().timeIntervalSince(date) > 7*86400 { try? FileManager.default.removeItem(at:file) }
        }
        let remaining = ((try? FileManager.default.contentsOfDirectory(at:root,includingPropertiesForKeys:[.contentModificationDateKey])) ?? []).sorted {
            ((try? $0.resourceValues(forKeys:[.contentModificationDateKey]).contentModificationDate) ?? .distantPast) < ((try? $1.resourceValues(forKeys:[.contentModificationDateKey]).contentModificationDate) ?? .distantPast)
        }
        for file in remaining.prefix(max(0,remaining.count-31)) { try? FileManager.default.removeItem(at:file) }
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        var url = root; try url.setResourceValues(values)
        return root
    }
    static func load(_ key: String) throws -> [String:Any]? {
        let file = try directory().appendingPathComponent(key+".json")
        guard FileManager.default.fileExists(atPath:file.path) else { return nil }
        let size = try file.resourceValues(forKeys:[.fileSizeKey]).fileSize ?? 0
        guard size <= 9*1024*1024 else { throw WhitePadError.connectionFailed("Recovery file exceeds limit") }
        return try JSONSerialization.jsonObject(with:Data(contentsOf:file)) as? [String:Any]
    }
    static func save(_ value: [String:Any], key: String) throws {
        let data = try JSONSerialization.data(withJSONObject:value)
        guard data.count <= 9*1024*1024 else { throw WhitePadError.connectionFailed("Recovery file exceeds limit") }
        let file = try directory().appendingPathComponent(key+".json")
        try data.write(to:file,options:.atomic)
        #if os(iOS)
        try FileManager.default.setAttributes([.protectionKey:FileProtectionType.completeUntilFirstUserAuthentication],ofItemAtPath:file.path)
        #endif
    }
}

protocol NativeRecoveryPersistence {
    func loadSession(_ key: String) throws -> NativeSessionRecord?
    func saveSession(_ record: NativeSessionRecord, key: String) throws
    func loadBoard(_ key: String) throws -> [String:Any]?
    func saveBoard(_ value: [String:Any], key: String) throws
}
struct DeviceRecoveryPersistence: NativeRecoveryPersistence {
    func loadSession(_ key: String) throws -> NativeSessionRecord? { try NativeRecoveryStore.session(key) }
    func saveSession(_ record: NativeSessionRecord, key: String) throws { try NativeRecoveryStore.saveSession(record,key:key) }
    func loadBoard(_ key: String) throws -> [String:Any]? { try NativeRecoveryStore.load(key) }
    func saveBoard(_ value: [String:Any], key: String) throws { try NativeRecoveryStore.save(value,key:key) }
}
