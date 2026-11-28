# Fabric P2P / 中继网格 —— 调研综合分析与方案建议

> 证据文件（同目录，均为 read-only 调研产物）：
> - `cradle-fabric-audit.md` —— Cradle 现状审计
> - `kero-transport-study.md` —— kero 传输与连接性研究
> - `tailscale-p2p-relay-survey.md` —— Tailscale 式 P2P/中继调研（含 libp2p/TURN/Syncthing/ZeroTier 横评）
>
> 本文是编排者的综合判断。标注 [共识] 的结论有三份报告或代码证据支撑；[判断] 是我的设计意见。

---

## 1. 先纠正问题的前提

**"Cradle 没有中继能力"不成立。** `apps/relayd` + Fabric 协议已经是一套完整、相当精良的中心化中继：

- 端到端加密：X25519 ECDH + HKDF 按路由派生密钥，AES-256-GCM/XChaCha20，**relayd 从头到尾看不到明文**；
- 成员体系：Ed25519 签名证书、按 Node 的 `view/control/approve` 授权、撤销闭环；
- 流控与公平：per-stream 信用窗口（512 KiB → 8 MiB 自适应）、16 MiB 连接级上限、relayd 侧 per-stream round-robin 调度 + 控制帧预留带宽 + 背压而非断连；
- 已有 adverse-network / latency-window benchmark 量化传输行为。

真正的缺口（[共识]，全仓库 grep 零命中 + 审计证据）：

1. **单点星型拓扑**——一个 Fabric 绑死一个 relayd 的 SQLite 和一条 `relayUrl`；relayd 挂了或远了，全网没有第二条路；
2. **没有直连路径**——任何流量都必须穿过 relayd 的 WebSocket/TCP，两段 TCP 串联 + 内核态 HoL blocking；
3. **没有中继冗余与自动选择**——没有测量、没有择优、没有 failover；
4. **没有任何 UDP/NAT 穿越机制**——Tailscale 在仓库里只是设置页里一句手动指引文案。

你提出的两个想法——"部署一个中继"和"UDP P2P + 任意节点做中继"——**不是二选一的对立方案**。Tailscale 的架构本身给出了答案：中继是地板（floor），直连是优化（optimization），两者共享同一套加密会话，按测量结果自动择优。你的直觉方向和这个架构完全一致。

## 2. kero 调研的关键发现：它可能没有你想的那种东西

**kero 自己没有实现任何 NAT 穿越、UDP 或中继**（grep 全仓库零命中，go.mod 无 QUIC/UDP 依赖）。它的远程连接是买来的：

- SSH 路径：直接 shell out 系统 OpenSSH，白拿 `~/.ssh/config` 里的跳板机/代理配置；
- Tailscale 路径：直接把 listener 绑在 tailnet IP 上，**打洞、DERP 中继、WireGuard 加密全部外包给系统 tailscaled**，连身份认证都用 tailscaled 的 whois。

所以 kero 在"连通性"上没有可借鉴的机制——但它证明了另一个更重要的东西，[共识] 三份报告都指向它：

> **kero 的稳定性来自一个赌注而不是机制：所有硬状态都在 daemon 里，每条流都可以从快照重新生成，所以传输失败是廉价的。**

没有序列号、没有重放缓冲、没有可恢复字节流。断线重连 = 重新 attach = 首帧全量重同步。这个模式对 Cradle 的价值比对 kero 还大：**如果流是可再生成的，那么"把一条连接从中继路径迁移到直连路径"就是一次普通的重新 attach，没有什么需要交接**。这正是中继/直连自动切换最难的部分，而 Cradle 的 server-hosted session 状态天然就是 daemon 化的。

顺带：Cradle 目前的 Fabric Session 恰好相反——协议明确写着 "Mutations and streams are never replayed automatically after link failure"，断链即丢。若要走多路径，这是比 UDP 更先决的问题。

## 3. 最重要的一个事实：Tailscale 自己已经走向了你的方案

[fact，见 tailscale-p2p-relay-survey.md §1.3/§7.4] 当前 Tailscale 源码里：

- 著名的**生日悖论打洞已经被移除**——对 hard×hard NAT，Tailscale 放弃了硬猜端口；
- 取而代之的是 **`net/udprelay`：普通 Tailscale 节点充当 UDP 中继**，通过 disco 消息族（`AllocateUDPRelayEndpoint*` / `BindUDPRelayEndpoint*` / `CallMeMaybeVia`）分配和绑定。

也就是说，"任意电脑都可以是中继"不是异想天开，而是**这个领域最成熟的玩家刚刚亲自验证过的方向**。`net/udprelay` 应该作为第一参考实现精读。

## 4. 横评结论：为什么 Cradle 做这件事比谁都便宜

libp2p / TURN / Syncthing / ZeroTier 横评（见 survey §4.6）得出三条规律：

1. **发现（discovery）才是难点，转发不是**。所有系统要么中心化发现（Syncthing pool、ZeroTier planet、Tailscale control），要么靠 DHT gossip。而 Cradle 的 fabric store **天然就是中心目录**——白送。
2. **激励/记账问题没人解决过**——但在 Cradle 里这个问题基本不存在：一个 Fabric 内所有 Node 同属一个 owner，互相中继是"自家设备互助"，不是给陌生人捐带宽。跨 Fabric 中继直接禁止即可（现有证书/授权体系已经能表达）。
3. **最低限度防滥用**只需要：签名 + 过期的 reservation、按连接的字节/时长上限、relay 侧 ACL。Cradle 的证书授权体系比以上所有系统的都强。

另外 relayd 的角色可以顺势升华：Tailscale 的 control plane 唯一不可替代的职责是**目录 + 测量 oracle**，从不碰数据面。relayd 已经是目录，加上测量收集就是完整的协调者——"中心的只有一个目录，中继遍地都是"。

## 5. 推荐架构（[判断]，供讨论，不构成实施）

### 路径分层

```
应用流量（HTTP byte stream）
   └─ Fabric Session v2（E2E 加密 + 流控，不变）
        └─ Path layer（新增）：按测量择优，可热迁移
             ├─ direct UDP/QUIC（打洞成功时）
             ├─ peer-relay UDP（打洞失败、有 volunteer 节点时）
             └─ relayd WebSocket（永远的地板，UDP 被禁的网络）
```

- **relayd WebSocket 路径永远保留**：企业网禁 UDP 时它是唯一活路，这和 Tailscale 的 DERP-over-HTTPS 是同一个设计理由。
- **信令走 disco 式 E2E 加密通道**：候选地址交换（CallMeMaybe 式）必须本身加密、且能穿过中继——初期可以直接复用 fabric envelope 空间，不用新协议。
- **打洞只做 endpoint-independent 部分** + fixed-port 候选 + UPnP/PMP/PCP + IPv6；**不做生日悖论**（Tailscale 已弃）。打不通就落 peer-relay，这是 udprelay 验证过的分工。
- **relay 选择抄 DERP 的迟滞常数**（改进 <10ms 不切、新延迟 <⅔ 才切、8s 帧活性宽限），防止抖动来回横跳。
- **volunteer 节点通过目录宣告 relay 能力**，授权复用现有 grant 体系，加 per-connection 字节/时长上限（libp2p 式）。
- 安全姿态零变化：中继（基础设施或 peer）自始至终只见密文——现有设计已经是这样，这是全盘成立的地基。

### 分阶段（每阶段独立可交付、可回退）

| 阶段 | 内容 | 价值 | 难点 |
|---|---|---|---|
| 0 | 会话可恢复化：fabric stream 支持 snapshot+resync（kero 模式），路径无关 | 断链不再丢会话，是后续一切的前提 | 协议演进（seq/ack 字段正闲置着，是现成的扩展点） |
| 1 | 端点宣告 + netcheck 式 NAT 探测 + disco 信令（复用 envelope） | 知道每台机器的 NAT 类型和候选地址 | relayd 目录 schema 扩展 |
| 2 | server↔server（Node↔Node / Node↔Controller on desktop）UDP 打洞直连 | 主流场景延迟腰斩，绕开 relayd | Node 有 `dgram` 但没有 QUIC——传输层选型是真问题（见下） |
| 3 | 节点 volunteer relay + udprelay 式分配 + DERP 式择优 | 你的完整愿景：自动发现最佳中继点 | relayd 星型 hub 要开出 hop 路由，最深的改动 |
| 4 | 多 relayd / 目录联邦、mobile 原生 UDP | 冗余与全平台覆盖 | mobile 目前纯 JS over RN WebSocket，需要原生代码 |

### 传输层选型——最需要你先拍板的技术问题

调研结论：QUIC（quic-go）在 Go 和 iOS（gomobile，Tailscale 同款架构）都成熟，但 **Node.js/Electron 没有可用的 QUIC**（`node:quic` 仍是实验性），浏览器更是永远不可能有裸 UDP。Cradle 的 Node/Controller 数据面目前在 TypeScript（Node）里。可选路线：

- **A. Go sidecar**：把 UDP/QUIC/打洞/中继都做进 Go 进程（自然延伸 relayd，或每机一个 fabric agent），TS server 通过本地 socket 把 envelope 交给它转发。加密会话层保持在 TS 不动——sidecar 和 relayd 一样只见密文。代价：分发和生命周期管理变复杂（desktop 已经有管理 relayd 子进程的先例，模式现成）。
- **B. 纯 TS/Node：`dgram` + 自制可靠数据报**。能复用现有 crypto 层，但可靠传输/拥塞控制自己写等于重新发明一个烂版 QUIC——不建议。
- **C. pion/WebRTC 全平台统一**。覆盖面最广（浏览器/Safari 都行），但把 ICE/SDP/DTLS 整套冗余机器搬进一个已经有自己 NAT 穿越设计的系统，重。
- 我的倾向：**A**，理由：打洞和 udprelay 的参考实现全部是 Go，quic-go 成熟，Tailscale 用同构架构 shipped 到所有平台包括 iOS；TS 侧只多一个本地 IPC，session 层零改动。浏览器 Controller 永远走 WebSocket 地板，不受影响。

## 6. 验证方式建议（实施时）

- 复用现有 `adverse-network-benchmark` 的确定性虚拟网线框架，对比同一路径 relay-only vs direct 的 RTT-窗口成本；
- NAT 场景测试可以抄 Tailscale 的 `tstest/natlab` 思路（虚拟化 easy/hard NAT）；
- 中继择优的正确性用迟滞参数注入抖动测量来验证，不做真实网络依赖。

## 7. 开放问题（需要讨论，不阻塞结论）

1. **传输层路线**（§5，A/B/C）——影响整个实施形态；
2. 阶段 0 的会话可恢复化是否接受进 fabric 协议 v3 演进（seq/ack 语义定义）；
3. volunteer relay 是否允许非 owner 信任的 controller-only 设备参与（建议：否，仅 Node）；
4. mobile 直连的优先级——它的 AES-GCM 基线 + RN WebSocket 限制意味着要么原生模块要么永远走中继，可以最后做。
