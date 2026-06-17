import Foundation
import EventKit

func jsonOutput(_ obj: Any) {
    guard let data = try? JSONSerialization.data(withJSONObject: obj),
          let str = String(data: data, encoding: .utf8) else {
        print("{\"error\":\"serialization failed\"}")
        return
    }
    print(str)
}

func fail(_ msg: String) -> Never {
    jsonOutput(["error": msg])
    exit(1)
}

func parseOpts(_ args: [String]) -> [String: String] {
    var opts: [String: String] = [:]
    var i = 0
    while i < args.count {
        if args[i].hasPrefix("--"), i + 1 < args.count {
            opts[String(args[i].dropFirst(2))] = args[i + 1]
            i += 2
        } else {
            i += 1
        }
    }
    return opts
}

func reminderToDict(_ r: EKReminder) -> [String: Any] {
    var d: [String: Any] = [
        "id": r.calendarItemIdentifier,
        "name": r.title ?? "",
        "list": r.calendar?.title ?? "",
        "priority": r.priority,
        "dueDate": NSNull(),
    ]
    if let comps = r.dueDateComponents,
       let date = Calendar.current.date(from: comps) {
        d["dueDate"] = ISO8601DateFormatter().string(from: date)
    }
    return d
}

// Request Reminders access
let store = EKEventStore()
let accessSem = DispatchSemaphore(value: 0)
var accessGranted = false

if #available(macOS 14.0, *) {
    store.requestFullAccessToReminders { granted, _ in
        accessGranted = granted
        accessSem.signal()
    }
} else {
    store.requestAccess(to: .reminder) { granted, _ in
        accessGranted = granted
        accessSem.signal()
    }
}
accessSem.wait()
guard accessGranted else { fail("Reminders access denied") }

let rawArgs = Array(CommandLine.arguments.dropFirst())
guard let command = rawArgs.first else { fail("no command given") }
let opts = parseOpts(Array(rawArgs.dropFirst()))

switch command {

case "list":
    let calendars = store.calendars(for: .reminder)
    let predicate = store.predicateForIncompleteReminders(
        withDueDateStarting: nil, ending: nil, calendars: calendars
    )
    let fetchSem = DispatchSemaphore(value: 0)
    var reminders: [EKReminder] = []
    store.fetchReminders(matching: predicate) { fetched in
        reminders = fetched ?? []
        fetchSem.signal()
    }
    fetchSem.wait()
    jsonOutput(reminders.map { reminderToDict($0) })

case "add":
    guard let name = opts["name"], !name.isEmpty else { fail("--name required") }
    let calendars = store.calendars(for: .reminder)
    let cal: EKCalendar?
    if let listName = opts["list"] {
        cal = calendars.first { $0.title == listName } ?? store.defaultCalendarForNewReminders()
    } else {
        cal = store.defaultCalendarForNewReminders()
    }
    guard let cal else { fail("no reminder calendar available") }
    let reminder = EKReminder(eventStore: store)
    reminder.title = name
    reminder.calendar = cal
    if let dueStr = opts["due"],
       let date = ISO8601DateFormatter().date(from: dueStr) {
        reminder.dueDateComponents = Calendar.current.dateComponents(
            [.year, .month, .day, .hour, .minute], from: date
        )
    }
    do {
        try store.save(reminder, commit: true)
        jsonOutput(reminderToDict(reminder))
    } catch {
        fail("save failed: \(error.localizedDescription)")
    }

case "complete":
    guard let id = opts["id"] else { fail("--id required") }
    guard let item = store.calendarItem(withIdentifier: id) as? EKReminder else {
        fail("reminder not found")
    }
    item.isCompleted = true
    do {
        try store.save(item, commit: true)
        jsonOutput(["ok": true])
    } catch {
        fail("save failed: \(error.localizedDescription)")
    }

case "update":
    guard let id = opts["id"] else { fail("--id required") }
    guard let item = store.calendarItem(withIdentifier: id) as? EKReminder else {
        fail("reminder not found")
    }
    if let name = opts["name"] { item.title = name }
    if let dueStr = opts["due"],
       let date = ISO8601DateFormatter().date(from: dueStr) {
        item.dueDateComponents = Calendar.current.dateComponents(
            [.year, .month, .day, .hour, .minute], from: date
        )
    }
    do {
        try store.save(item, commit: true)
        jsonOutput(reminderToDict(item))
    } catch {
        fail("save failed: \(error.localizedDescription)")
    }

case "delete":
    guard let id = opts["id"] else { fail("--id required") }
    guard let item = store.calendarItem(withIdentifier: id) as? EKReminder else {
        fail("reminder not found")
    }
    do {
        try store.remove(item, commit: true)
        jsonOutput(["ok": true])
    } catch {
        fail("remove failed: \(error.localizedDescription)")
    }

default:
    fail("unknown command: \(command)")
}
