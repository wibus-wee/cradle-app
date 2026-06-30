export function DocsPage() {
  return (
    <div className="min-h-screen bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <header className="mb-16">
          <h1 className="text-3xl font-bold tracking-tight">@cradle/streamdown</h1>
          <p className="mt-3 text-neutral-600 dark:text-neutral-400">
            React 流式 Markdown 渲染器，支持平滑动画与多种预设配置。
          </p>
        </header>

        {/* 基本用法 */}
        <Section title="基本用法">
          <p className="mb-4 text-neutral-600 dark:text-neutral-400">
            <code className="text-sm">Streamdown</code>
{' '}
组件接收 markdown 字符串，在流式输入时自动启用动画渲染，停止后切换为静态渲染。
          </p>
          <CodeBlock>
{`import { Streamdown } from '@cradle/streamdown'

function Chat({ message, isStreaming }) {
  return (
    <Streamdown
      content={message}
      streaming={isStreaming}
    />
  )
}`}
          </CodeBlock>
        </Section>

        {/* 动画预设 */}
        <Section title="动画预设 (Animation Presets)">
          <p className="mb-4 text-neutral-600 dark:text-neutral-400">
            三种内置动画预设控制视觉效果强度。通过
{' '}
<code className="text-sm">animationPreset</code>
{' '}
属性选择。
          </p>
          <div className="mb-4 space-y-3">
            <PresetCard
              name="minimal"
              description="无模糊、无位移、无特效，仅有基础淡入"
              details="fadeDuration: 200ms, ease-out"
            />
            <PresetCard
              name="balanced"
              description="轻微位移 + 块级发光效果"
              details="fadeDuration: 280ms, translateY: 2px, blockGlow: true"
            />
            <PresetCard
              name="dramatic"
              description="模糊 + 位移 + 发光 + 光标拖尾 + 块入场动画"
              details="fadeDuration: 350ms, blur: 2px, translateY: 4px, all effects on"
            />
          </div>
          <CodeBlock>
{`<Streamdown
  content={text}
  streaming={true}
  animationPreset="dramatic"
/>`}
          </CodeBlock>
        </Section>

        {/* 平滑预设 */}
        <Section title="平滑预设 (Smooth Presets)">
          <p className="mb-4 text-neutral-600 dark:text-neutral-400">
            控制字符输出速率的平滑器。通过
{' '}
<code className="text-sm">preset</code>
{' '}
属性选择，影响流式输出的节奏感。
          </p>
          <div className="mb-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 dark:border-neutral-800">
                  <th className="py-2 pr-4 text-left font-medium">预设</th>
                  <th className="py-2 pr-4 text-left font-medium">baseCps</th>
                  <th className="py-2 pr-4 text-left font-medium">minCps</th>
                  <th className="py-2 text-left font-medium">maxCps</th>
                </tr>
              </thead>
              <tbody className="text-neutral-600 dark:text-neutral-400">
                <tr className="border-b border-neutral-100 dark:border-neutral-800/50">
                  <td className="py-2 pr-4 font-mono">balanced</td>
                  <td className="py-2 pr-4">38</td>
                  <td className="py-2 pr-4">14</td>
                  <td className="py-2">72</td>
                </tr>
                <tr className="border-b border-neutral-100 dark:border-neutral-800/50">
                  <td className="py-2 pr-4 font-mono">realtime</td>
                  <td className="py-2 pr-4">50</td>
                  <td className="py-2 pr-4">20</td>
                  <td className="py-2">96</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 font-mono">silky</td>
                  <td className="py-2 pr-4">28</td>
                  <td className="py-2 pr-4">10</td>
                  <td className="py-2">56</td>
                </tr>
              </tbody>
            </table>
          </div>
          <CodeBlock>
{`<Streamdown
  content={text}
  streaming={true}
  preset="silky"
/>`}
          </CodeBlock>
        </Section>

        {/* 动画粒度 */}
        <Section title="动画粒度 (Animate Mode)">
          <p className="mb-4 text-neutral-600 dark:text-neutral-400">
            <code className="text-sm">animateMode</code>
{' '}
控制动画的最小单位：按词或按字符逐步显示。
          </p>
          <CodeBlock>
{`// 按词显示（默认，更自然）
<Streamdown animateMode="word" ... />

// 按字符显示（更细腻，适合代码）
<Streamdown animateMode="char" ... />`}
          </CodeBlock>
        </Section>

        {/* 光标 */}
        <Section title="光标显示 (Show Cursor)">
          <p className="mb-4 text-neutral-600 dark:text-neutral-400">
            流式输出时默认在末尾显示闪烁光标。设置
{' '}
<code className="text-sm">showCursor=false</code>
{' '}
可隐藏。
          </p>
          <CodeBlock>
{`<Streamdown
  content={text}
  streaming={true}
  showCursor={false}
/>`}
          </CodeBlock>
        </Section>

        {/* 自定义组件 */}
        <Section title="自定义组件 (Custom Components)">
          <p className="mb-4 text-neutral-600 dark:text-neutral-400">
            通过
{' '}
<code className="text-sm">components</code>
{' '}
属性传入自定义 React 组件，替换默认的 markdown 元素渲染。
          </p>
          <CodeBlock>
{`import { Streamdown } from '@cradle/streamdown'

const customComponents = {
  code: ({ children, className }) => (
    <code className={\`\${className} bg-blue-50 dark:bg-blue-950 rounded px-1\`}>
      {children}
    </code>
  ),
  a: ({ href, children }) => (
    <a href={href} className="text-blue-600 underline" target="_blank">
      {children}
    </a>
  ),
}

<Streamdown
  content={text}
  streaming={true}
  components={customComponents}
/>`}
          </CodeBlock>
        </Section>

        {/* 自定义插件 */}
        <Section title="自定义插件 (Custom Plugins)">
          <p className="mb-4 text-neutral-600 dark:text-neutral-400">
            支持传入额外的 remark/rehype 插件，在内置插件之后执行。
          </p>
          <CodeBlock>
{`import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'

<Streamdown
  content={text}
  streaming={true}
  remarkPlugins={[remarkGfm]}
  rehypePlugins={[rehypeHighlight]}
/>`}
          </CodeBlock>
        </Section>

        {/* AnimationPreset 对象 */}
        <Section title="自定义动画预设对象">
          <p className="mb-4 text-neutral-600 dark:text-neutral-400">
            除了使用内置预设名称，还可以传入完整的
{' '}
<code className="text-sm">AnimationPreset</code>
{' '}
对象实现精细控制。
          </p>
          <CodeBlock>
{`import type { AnimationPreset } from '@cradle/streamdown'

const myPreset: AnimationPreset = {
  name: 'custom',
  containerClass: 'stream-custom',
  fadeDuration: 300,
  timingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
  revealBlur: '1px',
  revealTranslateY: '3px',
  blockGlow: true,
  cursorTrail: false,
  blockEntrance: true,
}

<Streamdown
  content={text}
  streaming={true}
  animationPreset={myPreset}
/>`}
          </CodeBlock>
        </Section>

        {/* Props 表 */}
        <Section title="Props 参考">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 dark:border-neutral-800">
                  <th className="py-2 pr-4 text-left font-medium">Prop</th>
                  <th className="py-2 pr-4 text-left font-medium">类型</th>
                  <th className="py-2 pr-4 text-left font-medium">默认值</th>
                  <th className="py-2 text-left font-medium">说明</th>
                </tr>
              </thead>
              <tbody className="text-neutral-600 dark:text-neutral-400">
                <PropRow
                  prop="content"
                  type="string"
                  defaultVal="—"
                  desc="要渲染的 Markdown 内容"
                />
                <PropRow
                  prop="streaming"
                  type="boolean"
                  defaultVal="false"
                  desc="是否处于流式输入状态"
                />
                <PropRow
                  prop="preset"
                  type="'balanced' | 'realtime' | 'silky'"
                  defaultVal="'balanced'"
                  desc="字符输出速率平滑预设"
                />
                <PropRow
                  prop="animationPreset"
                  type="'minimal' | 'balanced' | 'dramatic' | AnimationPreset"
                  defaultVal="undefined"
                  desc="动画视觉效果预设"
                />
                <PropRow
                  prop="animateMode"
                  type="'char' | 'word'"
                  defaultVal="'word'"
                  desc="动画最小粒度"
                />
                <PropRow
                  prop="showCursor"
                  type="boolean"
                  defaultVal="true"
                  desc="流式输出时是否显示闪烁光标"
                />
                <PropRow
                  prop="components"
                  type="Record<string, ComponentType>"
                  defaultVal="undefined"
                  desc="自定义 Markdown 元素渲染组件"
                />
                <PropRow
                  prop="rehypePlugins"
                  type="unknown[]"
                  defaultVal="undefined"
                  desc="额外的 rehype 插件"
                />
                <PropRow
                  prop="remarkPlugins"
                  type="unknown[]"
                  defaultVal="undefined"
                  desc="额外的 remark 插件"
                />
                <PropRow
                  prop="className"
                  type="string"
                  defaultVal="undefined"
                  desc="容器 CSS 类名"
                />
              </tbody>
            </table>
          </div>
        </Section>

        {/* AnimationPreset 接口 */}
        <Section title="AnimationPreset 接口">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 dark:border-neutral-800">
                  <th className="py-2 pr-4 text-left font-medium">字段</th>
                  <th className="py-2 pr-4 text-left font-medium">类型</th>
                  <th className="py-2 text-left font-medium">说明</th>
                </tr>
              </thead>
              <tbody className="text-neutral-600 dark:text-neutral-400">
                <InterfaceRow field="name" type="string" desc="预设唯一标识符" />
                <InterfaceRow field="containerClass" type="string" desc="应用到流式容器的 CSS 类" />
                <InterfaceRow field="fadeDuration" type="number" desc="淡入动画时长 (ms)" />
                <InterfaceRow field="timingFunction" type="string" desc="CSS timing function" />
                <InterfaceRow field="revealBlur" type="string" desc="显示时的模糊量 (0px = 无模糊)" />
                <InterfaceRow field="revealTranslateY" type="string" desc="显示时的 Y 轴位移" />
                <InterfaceRow field="blockGlow" type="boolean" desc="活跃流式块是否有发光效果" />
                <InterfaceRow field="cursorTrail" type="boolean" desc="光标是否有拖尾效果" />
                <InterfaceRow field="blockEntrance" type="boolean" desc="块是否有入场动画" />
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string, children: React.ReactNode }) {
  return (
    <section className="mb-14">
      <h2 className="mb-4 text-xl font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  )
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg bg-neutral-900 p-4 text-sm leading-relaxed text-neutral-100 dark:bg-neutral-900/80">
      <code>{children}</code>
    </pre>
  )
}

function PresetCard({ name, description, details }: { name: string, description: string, details: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-sm font-medium">{name}</span>
        <span className="text-sm text-neutral-500 dark:text-neutral-500">
—
{description}
        </span>
      </div>
      <p className="mt-1 font-mono text-xs text-neutral-400 dark:text-neutral-600">{details}</p>
    </div>
  )
}

function PropRow({ prop, type, defaultVal, desc }: { prop: string, type: string, defaultVal: string, desc: string }) {
  return (
    <tr className="border-b border-neutral-100 dark:border-neutral-800/50">
      <td className="py-2 pr-4 font-mono text-xs">{prop}</td>
      <td className="py-2 pr-4 font-mono text-xs">{type}</td>
      <td className="py-2 pr-4 font-mono text-xs">{defaultVal}</td>
      <td className="py-2 text-xs">{desc}</td>
    </tr>
  )
}

function InterfaceRow({ field, type, desc }: { field: string, type: string, desc: string }) {
  return (
    <tr className="border-b border-neutral-100 dark:border-neutral-800/50">
      <td className="py-2 pr-4 font-mono text-xs">{field}</td>
      <td className="py-2 pr-4 font-mono text-xs">{type}</td>
      <td className="py-2 text-xs">{desc}</td>
    </tr>
  )
}
