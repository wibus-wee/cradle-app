import ArgumentParser
import Foundation
import WatchOutCore

@main
struct WatchOutCLI: AsyncParsableCommand {
  static let configuration = CommandConfiguration(
    commandName: "watchout",
    abstract: "WatchOut — local Attention Object Store (parking slips).",
    version: "0.3.0",
    subcommands: [
      Create.self,
      Get.self,
      List.self,
      Search.self,
      Update.self,
      Complete.self,
      Reopen.self,
      Delete.self,
      Count.self,
      Export.self,
      Import.self,
      DeepLink.self,
      Path.self,
    ]
  )
}

extension WatchOutCLI {
  struct Create: ParsableCommand {
    static let configuration = CommandConfiguration(abstract: "Create an open attention item")

    @Argument(help: "Title")
    var title: String

    @Option(name: .long, help: "Optional body")
    var body: String?

    @Option(name: .long, help: "Optional deep link / URL")
    var href: String?

    @Option(name: .long, help: "Source tag (manual, agent, cradle, …)")
    var source: String = "cli"

    @Option(name: .long, help: "Audience: human | agent | any")
    var audience: String = AttentionItem.Audience.human.rawValue

    @Flag(name: .long, help: "Print JSON")
    var json = false

    func run() throws {
      let store = try WatchOutStore.makeDefault()
      guard let audience = AttentionItem.Audience(rawValue: audience) else {
        throw ValidationError("audience must be human|agent|any")
      }
      let item = try store.create(
        AttentionItemCreate(
          title: title,
          body: body,
          href: href,
          source: source,
          audience: audience
        )
      )
      try emit(item, json: json)
    }
  }

  struct Get: ParsableCommand {
    static let configuration = CommandConfiguration(abstract: "Get one item by id")

    @Argument(help: "Item id")
    var id: String

    @Flag(name: .long, help: "Print JSON")
    var json = false

    func run() throws {
      let store = try WatchOutStore.makeDefault()
      guard let item = try store.get(id: id) else {
        throw ValidationError("item not found: \(id)")
      }
      try emit(item, json: json)
    }
  }

  struct List: ParsableCommand {
    static let configuration = CommandConfiguration(abstract: "List attention items")

    @Option(name: .long, help: "Filter status: open | done | all")
    var status: String = "open"

    @Option(name: .long, help: "Filter audience: human | agent | any")
    var audience: String?

    @Option(name: .long, help: "Substring search across title/body/source/href")
    var search: String?

    @Option(name: .long, help: "Max rows")
    var limit: Int?

    @Flag(name: .long, help: "Print JSON")
    var json = false

    func run() throws {
      let store = try WatchOutStore.makeDefault()
      if !["all", "open", "done"].contains(status) {
        throw ValidationError("status must be open|done|all")
      }
      let statusFilter: AttentionItem.Status? = {
        switch status {
        case "all": return nil
        case "open": return .open
        case "done": return .done
        default: return nil
        }
      }()
      let audienceFilter = try audience.map { raw -> AttentionItem.Audience in
        guard let value = AttentionItem.Audience(rawValue: raw) else {
          throw ValidationError("audience must be human|agent|any")
        }
        return value
      }
      let items = try store.list(
        AttentionListQuery(
          status: statusFilter,
          audience: audienceFilter,
          search: search,
          limit: limit
        )
      )
      try emitList(items, json: json)
    }
  }

  struct Search: ParsableCommand {
    static let configuration = CommandConfiguration(abstract: "Search open + done items")

    @Argument(help: "Query substring")
    var query: String

    @Option(name: .long, help: "Max rows")
    var limit: Int = 50

    @Flag(name: .long, help: "Print JSON")
    var json = false

    func run() throws {
      let store = try WatchOutStore.makeDefault()
      let items = try store.list(
        AttentionListQuery(status: nil, search: query, limit: limit)
      )
      try emitList(items, json: json)
    }
  }

  struct Update: ParsableCommand {
    static let configuration = CommandConfiguration(abstract: "Update title/body/href/source/audience")

    @Argument(help: "Item id")
    var id: String

    @Option(name: .long, help: "New title")
    var title: String?

    @Option(name: .long, help: "New body (pass empty string to clear)")
    var body: String?

    @Flag(name: .long, help: "Clear body")
    var clearBody = false

    @Option(name: .long, help: "New href (pass empty string to clear)")
    var href: String?

    @Flag(name: .long, help: "Clear href")
    var clearHref = false

    @Option(name: .long, help: "New source tag")
    var source: String?

    @Option(name: .long, help: "Audience: human | agent | any")
    var audience: String?

    @Flag(name: .long, help: "Print JSON")
    var json = false

    func run() throws {
      let store = try WatchOutStore.makeDefault()
      let audienceValue = try audience.map { raw -> AttentionItem.Audience in
        guard let value = AttentionItem.Audience(rawValue: raw) else {
          throw ValidationError("audience must be human|agent|any")
        }
        return value
      }

      let bodyPatch: String?? = {
        if clearBody { return .some(nil) }
        if let body { return .some(body) }
        return nil
      }()
      let hrefPatch: String?? = {
        if clearHref { return .some(nil) }
        if let href { return .some(href.isEmpty ? nil : href) }
        return nil
      }()

      let item = try store.update(
        id: id,
        AttentionItemUpdate(
          title: title,
          body: bodyPatch,
          href: hrefPatch,
          source: source,
          audience: audienceValue
        )
      )
      try emit(item, json: json)
    }
  }

  struct Complete: ParsableCommand {
    static let configuration = CommandConfiguration(abstract: "Mark an item done (explicit)")

    @Argument(help: "Item id")
    var id: String

    @Flag(name: .long, help: "Print JSON")
    var json = false

    func run() throws {
      let store = try WatchOutStore.makeDefault()
      let item = try store.complete(id: id)
      try emit(item, json: json)
    }
  }

  struct Reopen: ParsableCommand {
    static let configuration = CommandConfiguration(abstract: "Reopen a done item")

    @Argument(help: "Item id")
    var id: String

    @Flag(name: .long, help: "Print JSON")
    var json = false

    func run() throws {
      let store = try WatchOutStore.makeDefault()
      let item = try store.reopen(id: id)
      try emit(item, json: json)
    }
  }

  struct Delete: ParsableCommand {
    static let configuration = CommandConfiguration(abstract: "Delete an item")

    @Argument(help: "Item id")
    var id: String

    func run() throws {
      let store = try WatchOutStore.makeDefault()
      try store.delete(id: id)
      print("deleted \(id)")
    }
  }

  struct Count: ParsableCommand {
    static let configuration = CommandConfiguration(abstract: "Count open items")

    func run() throws {
      let store = try WatchOutStore.makeDefault()
      print(try store.openCount())
    }
  }

  struct Export: ParsableCommand {
    static let configuration = CommandConfiguration(abstract: "Export all items as JSON")

    @Option(name: .shortAndLong, help: "Write to file instead of stdout")
    var output: String?

    func run() throws {
      let store = try WatchOutStore.makeDefault()
      let data = try store.exportJSON()
      if let output {
        try data.write(to: URL(fileURLWithPath: output), options: .atomic)
        print("exported \(output)")
      } else {
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data("\n".utf8))
      }
    }
  }

  struct Import: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "import",
      abstract: "Import items from a JSON file"
    )

    @Argument(help: "Path to JSON array of AttentionItem")
    var path: String

    @Flag(name: .long, help: "Replace all existing items")
    var replace = false

    func run() throws {
      let store = try WatchOutStore.makeDefault()
      let data = try Data(contentsOf: URL(fileURLWithPath: path))
      let count = try store.importJSON(data, replace: replace)
      print("imported \(count)")
    }
  }

  struct Path: ParsableCommand {
    static let configuration = CommandConfiguration(abstract: "Print the SQLite database path")

    func run() throws {
      print(try WatchOutStore.databaseURL().path)
    }
  }

  struct DeepLink: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "url",
      abstract: "Build or apply watchout:// deep links",
      subcommands: [Park.self, Item.self, Show.self, Apply.self]
    )
  }
}

extension WatchOutCLI.DeepLink {
  struct Park: ParsableCommand {
    static let configuration = CommandConfiguration(abstract: "Print a watchout://park URL")

    @Argument(help: "Title")
    var title: String

    @Option(name: .long, help: "Optional body")
    var body: String?

    @Option(name: .long, help: "Optional href")
    var href: String?

    @Option(name: .long, help: "Source tag")
    var source: String = "url"

    @Option(name: .long, help: "Audience: human | agent | any")
    var audience: String = AttentionItem.Audience.human.rawValue

    func run() throws {
      guard let audience = AttentionItem.Audience(rawValue: audience) else {
        throw ValidationError("audience must be human|agent|any")
      }
      guard let url = WatchOutURLRouter.parkURL(
        title: title,
        body: body,
        href: href,
        source: source,
        audience: audience
      ) else {
        throw ExitCode.failure
      }
      print(url.absoluteString)
    }
  }

  struct Item: ParsableCommand {
    static let configuration = CommandConfiguration(abstract: "Print a watchout://item URL")

    @Argument(help: "Item id")
    var id: String

    func run() throws {
      guard let url = WatchOutURLRouter.itemURL(id: id) else {
        throw ExitCode.failure
      }
      print(url.absoluteString)
    }
  }

  struct Show: ParsableCommand {
    static let configuration = CommandConfiguration(abstract: "Print watchout://show")

    func run() {
      print(WatchOutURLRouter.showURL().absoluteString)
    }
  }

  struct Apply: ParsableCommand {
    static let configuration = CommandConfiguration(
      abstract: "Parse a watchout:// URL and apply park actions against the local store"
    )

    @Argument(help: "watchout:// URL")
    var url: String

    @Flag(name: .long, help: "Print JSON")
    var json = false

    func run() throws {
      guard let parsed = URL(string: url),
            let link = WatchOutURLRouter.parse(parsed)
      else {
        throw ValidationError("invalid watchout:// URL")
      }

      let store = try WatchOutStore.makeDefault()
      switch link {
      case .park(let input):
        let item = try store.create(input)
        try emit(item, json: json)
      case .item(let id):
        guard let item = try store.get(id: id) else {
          throw ValidationError("item not found: \(id)")
        }
        try emit(item, json: json)
      case .show:
        print(WatchOutURLRouter.showURL().absoluteString)
      }
    }
  }
}

private func emit(_ item: AttentionItem, json: Bool) throws {
  if json {
    let data = try JSONEncoder.watchOut.encode(item)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
  } else {
    print("\(item.id)\t\(item.status.rawValue)\t\(item.title)")
  }
}

private func emitList(_ items: [AttentionItem], json: Bool) throws {
  if json {
    let data = try JSONEncoder.watchOut.encode(items)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
  } else if items.isEmpty {
    print("(no items)")
  } else {
    for item in items {
      let mark = item.status == .open ? "[ ]" : "[x]"
      let href = item.href.map { "  \($0)" } ?? ""
      print("\(mark) \(item.id.prefix(8))  \(item.title)\(href)")
    }
  }
}
