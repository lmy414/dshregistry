// tools/tests/categories.test.mjs — 12 能力域分类判定测试
// 覆盖:新四类(memory/security/media/integration)关键词判定、覆盖表优先级、
// 声明优先级(合法值生效/非法值忽略)、兜底 other、大小写不敏感、声明合法值直通。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inferCategory } from '../crawl.js'

const repo = (full_name, description = '', topics = []) => ({ full_name, description, topics })

test('新四类关键词判定(memory 记忆类)', () => {
  const pkg = {}
  const cases = [
    ['mnemon/dsh-memory', 'Durable long-term memory for DSH', ['memory'], 'memory'],
    ['owner/dsh-memories', 'conversation memories', [], 'memory'],
    ['owner/dsh-context-store', 'Context persistence: persistent memory across sessions', [], 'memory'],
    ['owner/dsh-knowledgebase', '本地知识库检索', [], 'memory'],
    ['owner/dsh-rag', 'RAG 知识库插件', [], 'memory'],
  ]
  for (const [name, desc, topics, want] of cases) {
    assert.equal(inferCategory(pkg, repo(name, desc, topics)), want, `${name} 应判为 ${want}`)
  }
})

test('新四类关键词判定(security 安全类)', () => {
  const pkg = {}
  const cases = [
    ['guardian/dsh-egress-guard', 'Egress guard with allowlist', ['security'], 'security'],
    ['owner/dsh-sandbox', 'Sandboxed execution with permission controls', [], 'security'],
    ['owner/dsh-audit-log', '安全审计与权限日志', [], 'security'],
    ['owner/dsh-vault', 'Secret vault', [], 'security'],
  ]
  for (const [name, desc, topics, want] of cases) {
    assert.equal(inferCategory(pkg, repo(name, desc, topics)), want, `${name} 应判为 ${want}`)
  }
})

test('新四类关键词判定(media 媒体类)', () => {
  const pkg = {}
  const cases = [
    ['maker/dsh-img-gen', 'AI 图像生成插件', ['media'], 'media'],
    ['maker/dsh-picgen', '文生图工具', [], 'media'],
    ['owner/dsh-ffmpeg', '视频/音频处理 ffmpeg 封装', [], 'media'],
    ['owner/dsh-tts', 'Text-to-speech voice output', [], 'media'],
    ['owner/dsh-music', '音乐播放与音效', [], 'media'],
  ]
  for (const [name, desc, topics, want] of cases) {
    assert.equal(inferCategory(pkg, repo(name, desc, topics)), want, `${name} 应判为 ${want}`)
  }
})

test('新四类关键词判定(integration 集成类)', () => {
  const pkg = {}
  const cases = [
    ['feishu/dsh-feishu-notify', '飞书通知与 webhook 集成', ['integration'], 'integration'],
    ['owner/dsh-slack', 'Slack notifications', [], 'integration'],
    ['owner/dsh-github-bot', 'GitHub bot for DSH', [], 'integration'],
    ['owner/dsh-smtp', 'Email notification integration', [], 'integration'],
  ]
  for (const [name, desc, topics, want] of cases) {
    assert.equal(inferCategory(pkg, repo(name, desc, topics)), want, `${name} 应判为 ${want}`)
  }
})

test('桥接(bridge)与集成(integration)的区分', () => {
  const pkg = {}
  // 协议/环境桥接 → bridge
  assert.equal(inferCategory(pkg, repo('wsl/dsh-wsl-bridge', 'WSL 环境桥接')), 'bridge')
  assert.equal(inferCategory(pkg, repo('bridge/dsh-proxy-bridge', '协议转换 bridge')), 'bridge')
  // SaaS/IM/通知对接 → integration
  assert.equal(inferCategory(pkg, repo('feishu/dsh-feishu', '飞书机器人对接')), 'integration')
})

test('覆盖表优先于关键词与声明', () => {
  const overrides = { 'manual/dsh-memory-tool': 'tool', 'manual/dsh-x': 'integration' }
  // 关键词会判 memory,但覆盖表压过 → tool
  assert.equal(inferCategory({}, repo('manual/dsh-memory-tool', 'memory context'), overrides), 'tool')
  // 声明与关键词均判 other/vision,覆盖表压过 → integration
  const pkg = { dsh: { registry: { category: 'vision' } } }
  assert.equal(inferCategory(pkg, repo('manual/dsh-x', 'vision ocr'), overrides), 'integration')
})

test('覆盖表非法值忽略(回落到声明/关键词)', () => {
  const overrides = { 'manual/dsh-bad': 'not-a-cat' }
  const pkg = { dsh: { registry: { category: 'media' } } }
  assert.equal(inferCategory(pkg, repo('manual/dsh-bad', 'video tool'), overrides), 'media')
  // 无声明 → 关键词兜底
  assert.equal(inferCategory({}, repo('manual/dsh-bad', 'video tool'), overrides), 'media')
})

test('声明合法值直接生效,优先于关键词', () => {
  const pkg = { dsh: { registry: { category: 'dashboard' } } }
  assert.equal(inferCategory(pkg, repo('owner/dsh-anything', 'mcp agent tool')), 'dashboard')
})

test('声明非法值忽略(回落关键词/other)', () => {
  const pkg = { dsh: { registry: { category: 'hax' } } }
  assert.equal(inferCategory(pkg, repo('owner/dsh-memory', 'memory')), 'memory')
  assert.equal(inferCategory(pkg, repo('owner/dsh-nothing', 'no signal here')), 'other')
})

test('兜底 other', () => {
  const pkg = {}
  assert.equal(inferCategory(pkg, repo('nagi/dsh-ads', 'parody popups for web ui')), 'other')
  assert.equal(inferCategory(pkg, repo('x/y', '')), 'other')
})

test('关键词大小写不敏感(includes 语义)', () => {
  const pkg = {}
  assert.equal(inferCategory(pkg, repo('owner/DASHBOARD', 'MY MEMORY NOTES')), 'dashboard')
  assert.equal(inferCategory(pkg, repo('owner/x', 'Webhook Notification Hub')), 'integration')
  assert.equal(inferCategory(pkg, repo('owner/tts', 'SPEECH output')), 'media')
})

test('keyword 不误伤:bridge 优先于 tool/integration 的通用词', () => {
  const pkg = {}
  assert.equal(inferCategory(pkg, repo('owner/dsh-wsl-tool', 'wsl 工具')), 'bridge')
})
