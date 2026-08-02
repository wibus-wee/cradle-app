import SwiftUI
import WatchOutCore

struct AttentionItemRow: View {
  let item: AttentionItem
  let onComplete: () -> Void
  let onReopen: () -> Void
  let onDelete: () -> Void
  let onOpenHref: () -> Void
  let index: Int

  @State private var hovering = false

  var body: some View {
    HStack(alignment: .top, spacing: 0) {
      // Ticket stub / index rail
      VStack(spacing: 6) {
        Text(String(format: "%02d", index + 1))
          .font(.system(size: 10, weight: .bold, design: .monospaced))
          .foregroundStyle(WatchOutTheme.slate)
        WatchOutSignalDot(active: item.status == .open, size: 6)
        Spacer(minLength: 0)
      }
      .frame(width: 36)
      .padding(.top, 2)

      Rectangle()
        .fill(WatchOutTheme.hairline)
        .frame(width: 1)
        .padding(.vertical, 2)

      VStack(alignment: .leading, spacing: 8) {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
          Button(action: item.status == .open ? onComplete : onReopen) {
            Text(item.status == .open ? "MARK" : "UNDO")
              .font(.system(size: 9, weight: .heavy, design: .monospaced))
              .tracking(0.8)
              .foregroundStyle(item.status == .open ? WatchOutTheme.ink : WatchOutTheme.slate)
              .padding(.horizontal, 7)
              .padding(.vertical, 4)
              .background(
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                  .strokeBorder(WatchOutTheme.ink.opacity(item.status == .open ? 0.7 : 0.25), lineWidth: 1)
                  .background(
                    RoundedRectangle(cornerRadius: 2, style: .continuous)
                      .fill(item.status == .open ? WatchOutTheme.phosphorDim : Color.clear)
                  )
              )
          }
          .buttonStyle(WatchOutPressStyle())
          .help(item.status == .open ? "Mark done" : "Reopen")

          Text(item.title)
            .font(.system(size: 14, weight: .semibold, design: .default))
            .foregroundStyle(item.status == .done ? WatchOutTheme.slate : WatchOutTheme.ink)
            .strikethrough(item.status == .done, color: WatchOutTheme.slate)
            .multilineTextAlignment(.leading)
            .frame(maxWidth: .infinity, alignment: .leading)

          Button(action: onDelete) {
            Image(systemName: "xmark")
              .font(.system(size: 9, weight: .bold))
              .foregroundStyle(WatchOutTheme.slate)
              .frame(width: 22, height: 22)
              .background(
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                  .fill(hovering ? WatchOutTheme.danger.opacity(0.12) : Color.clear)
              )
          }
          .buttonStyle(WatchOutPressStyle())
          .opacity(hovering ? 1 : 0.15)
          .help("Delete")
        }

        if let body = item.body, !body.isEmpty {
          Text(body)
            .font(.system(size: 12.5, weight: .regular, design: .default))
            .foregroundStyle(WatchOutTheme.slate)
            .lineLimit(2)
        }

        HStack(spacing: 10) {
          Text(item.source.uppercased())
            .font(.system(size: 9, weight: .bold, design: .monospaced))
            .foregroundStyle(WatchOutTheme.slate)
          Text("·")
            .foregroundStyle(WatchOutTheme.hairline)
          Text(item.audience.rawValue.uppercased())
            .font(.system(size: 9, weight: .bold, design: .monospaced))
            .foregroundStyle(WatchOutTheme.slate)
          Text("·")
            .foregroundStyle(WatchOutTheme.hairline)
          Text(item.createdAt.formatted(.relative(presentation: .named)))
            .font(.system(size: 10, weight: .medium, design: .monospaced))
            .monospacedDigit()
            .foregroundStyle(WatchOutTheme.slate.opacity(0.9))
          if item.href != nil {
            Button("LINK →", action: onOpenHref)
              .buttonStyle(WatchOutPressStyle())
              .font(.system(size: 9, weight: .heavy, design: .monospaced))
              .foregroundStyle(WatchOutTheme.ink)
          }
        }
      }
      .padding(.leading, 12)
      .padding(.vertical, 12)
      .padding(.trailing, 10)
    }
    .padding(.leading, 8)
    .background(
      RoundedRectangle(cornerRadius: WatchOutTheme.ticketRadius, style: .continuous)
        .fill(WatchOutTheme.ticketFill)
        .shadow(color: .black.opacity(hovering ? 0.08 : 0.03), radius: hovering ? 8 : 2, y: 1)
    )
    .overlay(alignment: .leading) {
      Rectangle()
        .fill(item.status == .open ? WatchOutTheme.phosphor : WatchOutTheme.slate.opacity(0.25))
        .frame(width: 3)
        .clipShape(RoundedRectangle(cornerRadius: 1, style: .continuous))
        .padding(.vertical, 6)
        .padding(.leading, 2)
    }
    .overlay(
      RoundedRectangle(cornerRadius: WatchOutTheme.ticketRadius, style: .continuous)
        .strokeBorder(WatchOutTheme.hairline, lineWidth: 1)
    )
    .onHover { hovering = $0 }
    .animation(.easeOut(duration: 0.14), value: hovering)
  }
}

struct AttentionComposer: View {
  @Binding var title: String
  @FocusState private var focused: Bool
  let onSubmit: () -> Void

  private var canSubmit: Bool {
    !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("NEW SLIP")
        .font(.system(size: 9, weight: .heavy, design: .monospaced))
        .tracking(1.4)
        .foregroundStyle(WatchOutTheme.slate)

      HStack(spacing: 0) {
        TextField("What should not be forgotten?", text: $title)
          .textFieldStyle(.plain)
          .font(.system(size: 14, weight: .medium))
          .focused($focused)
          .onSubmit(onSubmit)
          .padding(.horizontal, 12)
          .padding(.vertical, 12)

        Button(action: onSubmit) {
          Text("PARK")
            .font(.system(size: 11, weight: .heavy, design: .monospaced))
            .tracking(1)
            .foregroundStyle(canSubmit ? WatchOutTheme.ink : WatchOutTheme.slate)
            .padding(.horizontal, 14)
            .frame(maxHeight: .infinity)
            .background(canSubmit ? WatchOutTheme.phosphor : Color.black.opacity(0.04))
        }
        .buttonStyle(WatchOutPressStyle())
        .disabled(!canSubmit)
        .keyboardShortcut(.return, modifiers: [.command])
      }
      .background(
        RoundedRectangle(cornerRadius: 3, style: .continuous)
          .strokeBorder(
            focused ? WatchOutTheme.ink.opacity(0.55) : WatchOutTheme.hairline,
            lineWidth: focused ? 1.5 : 1
          )
      )
      .animation(.easeOut(duration: 0.12), value: focused)
    }
  }
}

struct AttentionEmptyState: View {
  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack(spacing: 8) {
        WatchOutSignalDot(active: false, size: 7)
        Text("NO OPEN SIGNALS")
          .font(.system(size: 11, weight: .heavy, design: .monospaced))
          .tracking(1.5)
          .foregroundStyle(WatchOutTheme.slate)
      }
      Text("Park a follow-up before you context-switch.\nOpening a chat won’t clear it.")
        .font(.system(size: 13.5, weight: .medium))
        .foregroundStyle(WatchOutTheme.ink.opacity(0.72))
        .fixedSize(horizontal: false, vertical: true)
      Text("CMD+N FROM FLOATING · OR JUST TYPE ABOVE")
        .font(.system(size: 9, weight: .bold, design: .monospaced))
        .tracking(0.8)
        .foregroundStyle(WatchOutTheme.slate.opacity(0.8))
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(18)
    .background(
      RoundedRectangle(cornerRadius: WatchOutTheme.ticketRadius, style: .continuous)
        .strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
        .foregroundStyle(WatchOutTheme.hairline)
    )
    .padding(.horizontal, 16)
    .padding(.vertical, 18)
  }
}

struct AttentionListPane: View {
  @Bindable var model: WatchOutAppModel
  var compact: Bool = false

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      header
        .padding(.horizontal, 16)
        .padding(.top, compact ? 14 : 10)
        .padding(.bottom, 14)

      AttentionComposer(title: $model.draftTitle) {
        model.createFromDraft()
      }
      .padding(.horizontal, 16)
      .padding(.bottom, 14)

      if let errorMessage = model.errorMessage {
        Text(errorMessage)
          .font(.system(size: 11, weight: .medium, design: .monospaced))
          .foregroundStyle(WatchOutTheme.danger)
          .padding(.horizontal, 16)
          .padding(.bottom, 8)
      }

      // Scanline divider
      ZStack(alignment: .leading) {
        Rectangle().fill(WatchOutTheme.hairline).frame(height: 1)
        Rectangle()
          .fill(WatchOutTheme.phosphor)
          .frame(width: 48, height: 2)
      }
      .padding(.horizontal, 16)

      Group {
        if model.items.isEmpty {
          AttentionEmptyState()
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        } else {
          ScrollView {
            LazyVStack(spacing: 8) {
              ForEach(Array(model.items.enumerated()), id: \.element.id) { index, item in
                AttentionItemRow(
                  item: item,
                  onComplete: { model.complete(item) },
                  onReopen: { model.reopen(item) },
                  onDelete: { model.delete(item) },
                  onOpenHref: { model.openHref(item) },
                  index: index
                )
              }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
          }
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    .onAppear { model.refresh() }
  }

  private var header: some View {
    VStack(alignment: .leading, spacing: compact ? 8 : 12) {
      HStack(alignment: .center) {
        WatchOutStamp(compact: compact)
        Spacer()
        WatchOutCountTape(count: model.openCount)
      }

      HStack(alignment: .firstTextBaseline) {
        Text(compact ? "Later, without losing the thread." : "A desk for unfinished attention.")
          .font(.system(size: compact ? 12 : 20, weight: compact ? .medium : .semibold))
          .foregroundStyle(WatchOutTheme.ink.opacity(0.88))
          .lineLimit(2)
        Spacer(minLength: 12)
        Button {
          model.showDone.toggle()
          model.refresh()
        } label: {
          Text(model.showDone ? "OPEN+DONE" : "OPEN ONLY")
            .font(.system(size: 9, weight: .heavy, design: .monospaced))
            .tracking(0.6)
            .foregroundStyle(model.showDone ? WatchOutTheme.ink : WatchOutTheme.slate)
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(
              RoundedRectangle(cornerRadius: 2, style: .continuous)
                .strokeBorder(WatchOutTheme.hairline, lineWidth: 1)
                .background(
                  RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .fill(model.showDone ? WatchOutTheme.phosphorDim : Color.clear)
                )
            )
        }
        .buttonStyle(WatchOutPressStyle())
        .help(model.showDone ? "Hide completed" : "Show completed")
      }
    }
  }
}
