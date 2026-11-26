// legion-key
// ==========
// RED ZONE (T1, DRAFT awaiting the user's sign-off): the one program
// Legion's two Keychain items trust (the terminal's own key,
// "legion-terminal-<host>", and a local Legion's sign-in secret,
// "legion-signin-<host>"), and it asks for the user's presence (Touch ID
// or the login password: LocalAuthentication) before every read. An item
// made here (set) trusts this binary only (its ACL's one trusted
// application, this exact code: ad hoc signed, its cdhash), not
// /usr/bin/security nor bun, so an agent's `security find-generic-password`
// gets a prompt, never the value; and "Always Allow" on this program's
// own prompt trusts only it, which still asks for Touch ID each time.
// Built from this source by local/legion (swiftc -O, codesign -s - -o
// runtime) into ~/.legion/bin/legion-key, mode 0700.
//
//   legion-key get <service> <account>     the value on stdout, after Touch ID
//   legion-key set <service> <account>     the value from stdin (never argv)
//   legion-key delete <service> <account>
//   legion-key acl <service> <account>     who the item trusts (no value)
//
// Exit: 0 done; 44 no such item; 45 an item not made here (it trusts
// someone else, or no one: made by `security -T ""`), never read; 1
// refused, cancelled, no Touch ID nor password, or the Keychain failed;
// 2 a wrong call (or a service not one of Legion's two). stdout holds
// only the value got, or acl's list of who is trusted (never a value).
// set and delete ask no Touch ID: replacing or deleting reveals nothing
// (and `security delete-generic-password` can delete any item anyway).

import Foundation
import LocalAuthentication
import Security

// the items this helper serves, and what its prompt calls each
let KINDS: [(prefix: String, what: String)] = [
  ("legion-terminal-", "the terminal's key"),
  ("legion-signin-", "this Legion's sign-in secret"),
]

func fail(_ code: Int32, _ why: String) -> Never {
  FileHandle.standardError.write(("legion-key: " + why + "\n").data(using: .utf8)!)
  exit(code)
}

// the item's query: a generic password of the login (file) keychain
func query(_ service: String, _ account: String) -> [String: Any] {
  return [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: service,
    kSecAttrAccount as String: account,
  ]
}

// the item's reference, if there is one (no value read, no prompt)
func item(_ service: String, _ account: String) -> SecKeychainItem? {
  var q = query(service, account)
  q[kSecReturnRef as String] = true
  q[kSecMatchLimit as String] = kSecMatchLimitOne
  var out: CFTypeRef?
  let s = SecItemCopyMatching(q as CFDictionary, &out)
  if s == errSecItemNotFound {
    return nil
  }
  if s != errSecSuccess || out == nil {
    fail(1, "the Keychain failed (" + String(s) + ")")
  }
  return (out as! SecKeychainItem)
}

// this program, as a trusted application's data
func me() -> Data {
  var app: SecTrustedApplication?
  if SecTrustedApplicationCreateFromPath(nil, &app) != errSecSuccess || app == nil {
    fail(1, "can't name itself to the Keychain")
  }
  var data: CFData?
  if SecTrustedApplicationCopyData(app!, &data) != errSecSuccess || data == nil {
    fail(1, "can't name itself to the Keychain")
  }
  return data! as Data
}

// who may read the item's value without a prompt: nil, anyone (an entry
// with no application list); else the trusted applications' data
func readers(_ it: SecKeychainItem) -> [Data]? {
  var access: SecAccess?
  if SecKeychainItemCopyAccess(it, &access) != errSecSuccess || access == nil {
    fail(1, "can't read the item's access list")
  }
  var list: CFArray?
  if SecAccessCopyACLList(access!, &list) != errSecSuccess || list == nil {
    fail(1, "can't read the item's access list")
  }
  var all: [Data] = []
  for acl in list! as! [SecACL] {
    let auths = SecACLCopyAuthorizations(acl) as! [String]
    if !auths.contains(kSecACLAuthorizationDecrypt as String) && !auths.contains(kSecACLAuthorizationAny as String) {
      continue
    }
    var apps: CFArray?
    var desc: CFString?
    var prompt = SecKeychainPromptSelector()
    if SecACLCopyContents(acl, &apps, &desc, &prompt) != errSecSuccess {
      fail(1, "can't read the item's access list")
    }
    if apps == nil {
      return nil
    }
    for app in apps! as! [SecTrustedApplication] {
      var data: CFData?
      if SecTrustedApplicationCopyData(app, &data) == errSecSuccess, let d = data {
        all.append(d as Data)
      }
    }
  }
  return all
}

// whether only this program reads the item's value unprompted
func mine(_ it: SecKeychainItem) -> Bool {
  guard let r = readers(it) else {
    return false
  }
  let self_ = me()
  return !r.isEmpty && r.allSatisfy { $0 == self_ }
}

// a fresh check of the user's presence (Touch ID, else the login
// password), nothing reused: false if refused, cancelled or unavailable
func present(_ reason: String) -> Bool {
  let ctx = LAContext()
  ctx.touchIDAuthenticationAllowableReuseDuration = 0
  var err: NSError?
  if !ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &err) {
    return false
  }
  let done = DispatchSemaphore(value: 0)
  var ok = false
  ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { yes, _ in
    ok = yes
    done.signal()
  }
  done.wait()
  ctx.invalidate()
  return ok
}

// an access list whose one trusted application is this program
func access(_ label: String) -> SecAccess {
  var app: SecTrustedApplication?
  if SecTrustedApplicationCreateFromPath(nil, &app) != errSecSuccess || app == nil {
    fail(1, "can't name itself to the Keychain")
  }
  var acc: SecAccess?
  if SecAccessCreate(label as CFString, [app!] as CFArray, &acc) != errSecSuccess || acc == nil {
    fail(1, "can't make the item's access list")
  }
  return acc!
}

let args = CommandLine.arguments
if args.count != 4 {
  fail(2, "usage: legion-key get|set|delete|acl <service> <account>")
}
let (verb, service, account) = (args[1], args[2], args[3])
guard let kind = KINDS.first(where: { service.hasPrefix($0.prefix) && service.count > $0.prefix.count }) else {
  fail(2, "not one of Legion's items: " + service)
}
let host = String(service.dropFirst(kind.prefix.count))

switch verb {
case "get":
  guard let it = item(service, account) else {
    exit(44)
  }
  if !mine(it) {
    fail(45, "this item wasn't made by legion-key (run legion login)")
  }
  if !present("Legion: " + kind.what + " for " + host) {
    fail(1, "not allowed")
  }
  var q = query(service, account)
  q[kSecReturnData as String] = true
  q[kSecMatchLimit as String] = kSecMatchLimitOne
  var out: CFTypeRef?
  let s = SecItemCopyMatching(q as CFDictionary, &out)
  if s != errSecSuccess || out == nil {
    fail(1, "the Keychain refused (" + String(s) + ")")
  }
  FileHandle.standardOutput.write(out as! Data)
  FileHandle.standardOutput.write("\n".data(using: .utf8)!)
case "set":
  var value = FileHandle.standardInput.readDataToEndOfFile()
  if value.last == 0x0a {
    value.removeLast()
  }
  if value.isEmpty || value.count > 4096 {
    fail(2, "no value on stdin")
  }
  // made again, so no older item's trust is kept
  let d = SecItemDelete(query(service, account) as CFDictionary)
  if d != errSecSuccess && d != errSecItemNotFound {
    fail(1, "the Keychain refused to replace the old item (" + String(d) + ")")
  }
  var q = query(service, account)
  q[kSecValueData as String] = value
  q[kSecAttrLabel as String] = service
  q[kSecAttrAccess as String] = access(service)
  let s = SecItemAdd(q as CFDictionary, nil)
  if s != errSecSuccess {
    fail(1, "the Keychain refused to keep it (" + String(s) + ")")
  }
case "delete":
  let s = SecItemDelete(query(service, account) as CFDictionary)
  if s == errSecItemNotFound {
    exit(44)
  }
  if s != errSecSuccess {
    fail(1, "the Keychain refused (" + String(s) + ")")
  }
case "acl":
  guard let it = item(service, account) else {
    exit(44)
  }
  let r = readers(it)
  print("readers: " + (r == nil ? "any application" : String(r!.count) + " trusted application(s)"))
  for d in r ?? [] {
    print("  " + (String(data: d.prefix(while: { $0 != 0 }), encoding: .utf8) ?? "?"))
  }
  print("only legion-key: " + (mine(it) ? "yes" : "no"))
default:
  fail(2, "usage: legion-key get|set|delete|acl <service> <account>")
}
