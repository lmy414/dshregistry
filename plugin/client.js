/**
 * dsh-marketplace browser half — 设置页"插件市场"栏。
 * 手写 CJS bundle(不需要构建工具):通过 window.__ModuleLoader__.load 注册
 * CJS factory,require 解析走平台种子表(react 等)。
 * 注册 settings.section 条目,提供"插件市场":浏览 dshregistry 收录的插件、
 * 查看三态标记与风险说明、热安装/热卸载(host 半执行)。
 * 数据来源:GET /dsh-marketplace/api/*(host 半提供)。
 */
(function () {
  if (typeof window === 'undefined' || typeof window.__ModuleLoader__ === 'undefined') return
  window.__ModuleLoader__.load({
    id: 'dsh-marketplace',
    factory: function (require) {
      var React = require('react')
      var h = React.createElement

      /* ---------- 常量 ---------- */

      var CATEGORIES = ['全部', '工具', '视觉', '看板', '桥接', '启动器', 'MCP', '技能', '其他']
      var STATE_META = {
        unreviewed: { label: '未审计', cls: 'mp-badge-gray', tip: '未经人工安全审计,无任何背书' },
        community: { label: '社区认可', cls: 'mp-badge-blue', tip: '社区反馈显示可用:收录≥30天、stars≥20或forks≥5、未被人工标记、作者账号≥90天' },
        flagged: { label: '有风险报告', cls: 'mp-badge-red', tip: '被站长/人工标记为有风险,不建议安装' },
      }

      /* ---------- 样式 ---------- */

      var styles = [
        '.mp-section{display:flex;flex-direction:column;gap:16px;max-width:760px;padding:4px 0 24px}',
        '.mp-topbar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}',
        '.mp-title{font-size:14px;font-weight:600;opacity:.9}',
        '.mp-subtitle{font-size:12px;opacity:.5;margin-top:2px}',
        '.mp-status{font-size:12px;opacity:.6}',
        '.mp-status.err{color:#e74c3c;opacity:1}',
        '.mp-btn{background:transparent;border:1px solid var(--dsw-border,rgba(255,255,255,.18));border-radius:6px;padding:5px 12px;font:inherit;font-size:12px;color:inherit;cursor:pointer;opacity:.7;transition:all .15s}',
        '.mp-btn:hover{opacity:1}',
        '.mp-btn.primary{background:var(--dsw-accent,#4a9eff);border-color:var(--dsw-accent,#4a9eff);color:#fff;opacity:1}',
        '.mp-btn.danger{color:#e74c3c;border-color:rgba(231,76,60,.5)}',
        '.mp-btn:disabled{opacity:.35;cursor:not-allowed}',
        '.mp-controls{display:flex;flex-direction:column;gap:8px}',
        '.mp-search{background:rgba(255,255,255,.05);border:1px solid var(--dsw-border,rgba(255,255,255,.18));border-radius:8px;padding:8px 12px;font:inherit;font-size:13px;color:inherit;outline:none;width:100%;box-sizing:border-box}',
        '.mp-search:focus{border-color:var(--dsw-accent,#4a9eff)}',
        '.mp-chips{display:flex;flex-wrap:wrap;gap:6px}',
        '.mp-chip{background:transparent;border:1px solid var(--dsw-border,rgba(255,255,255,.18));border-radius:999px;padding:3px 12px;font:inherit;font-size:12px;color:inherit;cursor:pointer;opacity:.55}',
        '.mp-chip:hover{opacity:.9}',
        '.mp-chip.on{opacity:1;background:var(--dsw-accent,#4a9eff);border-color:var(--dsw-accent,#4a9eff);color:#fff}',
        '.mp-cards{display:flex;flex-direction:column;gap:8px}',
        '.mp-card{background:var(--dsw-alias-bg-layer-2,#2c2c2e);border:1px solid transparent;border-radius:10px;padding:10px 14px;cursor:pointer;transition:border-color .15s}',
        '.mp-card:hover{border-color:var(--dsw-border,rgba(255,255,255,.25))}',
        '.mp-card.installed{border-color:rgba(74,158,255,.45)}',
        '.mp-card-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
        '.mp-card-name{font-size:13px;font-weight:600}',
        '.mp-card-cat{font-size:11px;opacity:.5;border:1px solid var(--dsw-border,rgba(255,255,255,.15));border-radius:4px;padding:0 6px}',
        '.mp-card-desc{font-size:12px;opacity:.65;margin-top:4px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
        '.mp-card-meta{display:flex;align-items:center;gap:10px;font-size:11px;opacity:.5;margin-top:6px;flex-wrap:wrap}',
        '.mp-badge{font-size:11px;border-radius:4px;padding:1px 7px;cursor:help}',
        '.mp-badge-gray{background:rgba(128,128,128,.22);color:#c8c8c8}',
        '.mp-badge-blue{background:rgba(74,158,255,.22);color:#7db9ff}',
        '.mp-badge-red{background:rgba(231,76,60,.25);color:#ff8a80}',
        '.mp-detail{border-top:1px solid var(--dsw-border,rgba(255,255,255,.12));margin-top:10px;padding-top:10px;display:flex;flex-direction:column;gap:8px}',
        '.mp-detail-row{display:flex;gap:8px;font-size:12px;flex-wrap:wrap}',
        '.mp-detail-row .k{opacity:.5;min-width:72px}',
        '.mp-detail-row .v{opacity:.9;word-break:break-all;font-family:ui-monospace,Menlo,Consolas,monospace}',
        '.mp-warning{border:1px solid rgba(231,76,60,.5);background:rgba(231,76,60,.08);border-radius:8px;padding:10px 12px;font-size:12px;line-height:1.6;color:#ffb4ac}',
        '.mp-warning b{color:#ff6b60}',
        '.mp-confirm{display:flex;align-items:flex-start;gap:8px;font-size:12px;opacity:.85}',
        '.mp-confirm input{margin-top:1px}',
        '.mp-actions{display:flex;gap:8px;flex-wrap:wrap}',
        '.mp-empty{font-size:12px;opacity:.55;padding:12px 0}',
        '.mp-sort{display:flex;gap:6px;align-items:center}',
        '.mp-sort select{background:transparent;border:1px solid var(--dsw-border,rgba(255,255,255,.18));border-radius:6px;padding:3px 8px;font:inherit;font-size:12px;color:inherit;outline:none}',
      ].join('\n')

      /* ---------- 工具函数 ---------- */

      function fmtRelative(iso) {
        if (!iso) return '—'
        var t = new Date(iso).getTime()
        if (isNaN(t)) return '—'
        var s = Math.floor((Date.now() - t) / 1000)
        if (s < 60) return '刚刚'
        if (s < 3600) return Math.floor(s / 60) + ' 分钟前'
        if (s < 86400) return Math.floor(s / 3600) + ' 小时前'
        if (s < 86400 * 30) return Math.floor(s / 86400) + ' 天前'
        return new Date(t).toISOString().slice(0, 10)
      }

      function api(path, options) {
        return fetch('/dsh-marketplace/api' + path, options).then(function (r) {
          return r.json().then(function (body) {
            if (!body || body.ok === false) throw new Error(body && body.error ? body.error : 'HTTP ' + r.status)
            return body
          })
        })
      }

      /* ---------- 组件 ---------- */

      function Badge(props) {
        var meta = STATE_META[props.state] || STATE_META.unreviewed
        return h('span', { className: 'mp-badge ' + meta.cls, title: meta.tip }, meta.label)
      }

      function ConfirmCheck(props) {
        return h('label', { className: 'mp-confirm', style: { display: 'flex' } },
          h('input', {
            type: 'checkbox',
            checked: props.checked,
            onChange: function (e) { props.onChange(e.target.checked) },
          }),
          h('span', null, '我了解风险,仍然安装'),
        )
      }

      function PluginCard(props) {
        var p = props.plugin
        var installed = props.installedSet[p.slug]
        var expanded = props.expanded === p.slug
        var busy = props.busy === p.slug

        function install() {
          if (!props.agreed[p.slug]) return
          props.onInstall(p.slug)
        }

        return h('div', {
          className: 'mp-card' + (installed ? ' installed' : '') + (expanded ? ' mp-open' : ''),
          onClick: function () { props.onToggle(p.slug) },
        },
          h('div', { className: 'mp-card-head' },
            h('span', { className: 'mp-card-name' }, p.name),
            h('span', { className: 'mp-card-cat' }, p.category || '其他'),
            h(Badge, { state: p.state }),
            installed ? h('span', { className: 'mp-status' }, '✓ 已安装') : null,
          ),
          h('div', { className: 'mp-card-desc' }, p.description || '(无描述)'),
          h('div', { className: 'mp-card-meta' },
            h('span', null, '★ ' + (p.stars ?? 0)),
            h('span', null, '更新于 ' + fmtRelative(p.pushedAt)),
            h('span', null, p.repo),
          ),
          expanded ? h('div', { className: 'mp-detail', onClick: function (e) { e.stopPropagation() } },
            h('div', { className: 'mp-detail-row' }, h('span', { className: 'k' }, '仓库'), h('span', { className: 'v' }, p.repo)),
            h('div', { className: 'mp-detail-row' }, h('span', { className: 'k' }, 'commit'), h('span', { className: 'v' }, (p.latestCommit || '').slice(0, 12) || '—')),
            h('div', { className: 'mp-detail-row' }, h('span', { className: 'k' }, '收录'), h('span', { className: 'v' }, fmtRelative(p.addedAt))),
            h('div', { className: 'mp-detail-row' }, h('span', { className: 'k' }, '标记依据'), h('span', { className: 'v' }, (p.stateReasons || []).join('; ') || '—')),
            h('div', { className: 'mp-detail-row' }, h('span', { className: 'k' }, '安装命令'), h('span', { className: 'v' }, p.installSpec || '—')),
            h('div', { className: 'mp-detail-row' }, h('span', { className: 'k' }, 'GitHub'), h('a', { href: p.githubUrl, target: '_blank', rel: 'noreferrer', style: { color: 'var(--dsw-accent,#4a9eff)' } }, '查看源码 ↗')),
            h('div', { className: 'mp-warning' },
              h('b', null, '此插件未经人工安全审计。'), ' 安装后将以你运行 DSH 的用户权限执行任意代码,可读写你的文件、访问网络。仅安装你信任的来源。插件在 DSH 主进程内运行,无沙箱隔离;安装 = 运行该插件的发布脚本与全部代码。建议先查看源码。'),
            h(ConfirmCheck, {
              checked: !!props.agreed[p.slug],
              onChange: function (v) { props.onAgree(p.slug, v) },
            }),
            h('div', { className: 'mp-actions' },
              h('button', {
                type: 'button',
                className: 'mp-btn primary',
                disabled: !props.agreed[p.slug] || busy,
                onClick: install,
              }, busy ? '安装中…' : '安装(热,无需重启)'),
              h('a', { className: 'mp-btn', href: p.githubUrl, target: '_blank', rel: 'noreferrer', style: { textDecoration: 'none', display: 'inline-block' } }, 'GitHub'),
            ),
          ) : null,
        )
      }

      function InstalledRow(props) {
        return h('div', { className: 'mp-card', style: { cursor: 'default' } },
          h('div', { className: 'mp-card-head' },
            h('span', { className: 'mp-card-name' }, props.row.name || props.row.id),
            h('span', { className: 'mp-card-cat' }, props.row.id),
            h('span', { className: 'mp-status' }, 'via ' + (props.row.via || 'patch')),
          ),
          h('div', { className: 'mp-actions', style: { marginTop: 8 } },
            h('button', {
              type: 'button',
              className: 'mp-btn danger',
              disabled: props.busy,
              onClick: function () {
                if (window.confirm('确认卸载 ' + (props.row.name || props.row.id) + '?\n将热卸载并从 profile 移除依赖。')) {
                  props.onUninstall(props.row.name || props.row.id)
                }
              },
            }, busy ? '卸载中…' : '卸载'),
          ),
        )
      }

      function MarketplaceSection() {
        var state = React.useState({
          loading: true, error: null, data: null, installed: null,
          search: '', category: '全部', sort: 'updated',
          expanded: null, agreed: {}, busy: null, result: null,
        })
        var view = state[0]
        var setView = state[1]

        function patch(partial) { setView(Object.assign({}, view, partial)) }

        function loadAll() {
          patch({ loading: true, error: null, result: null })
          Promise.all([
            api('/registry'),
            api('/installed'),
          ]).then(function (rs) {
            patch({ loading: false, data: rs[0], installed: rs[1] })
          }).catch(function (err) {
            patch({ loading: false, error: String(err.message || err) })
          })
        }

        React.useEffect(function () { loadAll() }, [])

        function doInstall(slug) {
          patch({ busy: slug, result: null })
          api('/install', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ slug: slug }),
          }).then(function (r) {
            patch({ busy: null, result: { ok: true, text: r.message } })
            loadAll()
          }).catch(function (err) {
            patch({ busy: null, result: { ok: false, text: String(err.message || err) } })
          })
        }

        function doUninstall(name) {
          patch({ busy: name, result: null })
          api('/uninstall', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: name }),
          }).then(function (r) {
            patch({ busy: null, result: { ok: true, text: r.message } })
            loadAll()
          }).catch(function (err) {
            patch({ busy: null, result: { ok: false, text: String(err.message || err) } })
          })
        }

        if (view.loading) {
          return h('div', { className: 'mp-section' },
            h('div', { className: 'mp-topbar' },
              h('div', null,
                h('div', { className: 'mp-title' }, '插件市场'),
                h('div', { className: 'mp-subtitle' }, '浏览 dshregistry 收录的插件,风险自负'),
              ),
            ),
            h('div', { className: 'mp-status' }, '加载中…'),
          )
        }

        if (view.error) {
          return h('div', { className: 'mp-section' },
            h('div', { className: 'mp-topbar' },
              h('div', null, h('div', { className: 'mp-title' }, '插件市场')),
              h('button', { type: 'button', className: 'mp-btn', onClick: loadAll }, '重试'),
            ),
            h('div', { className: 'mp-status err' }, '加载失败: ' + view.error),
          )
        }

        var plugins = (view.data && view.data.plugins) || []
        var blocked = (view.data && view.data.blocked) || []
        var installedSet = {}
        var patchRows = (view.installed && view.installed.patchRows) || []
        patchRows.forEach(function (r) { installedSet[r.id] = r })

        var q = view.search.trim().toLowerCase()
        var list = plugins.filter(function (p) {
          if (view.category !== '全部' && (p.category || '其他') !== view.category) return false
          if (q === '') return true
          return (p.name || '').toLowerCase().indexOf(q) >= 0 || (p.description || '').toLowerCase().indexOf(q) >= 0
        })
        list.sort(function (a, b) {
          if (view.sort === 'stars') return (b.stars || 0) - (a.stars || 0)
          return String(b.pushedAt || '').localeCompare(String(a.pushedAt || ''))
        })

        var resultNode = null
        if (view.result) {
          resultNode = h('div', { className: 'mp-status' + (view.result.ok ? '' : ' err') }, view.result.text)
        }

        return h('div', { className: 'mp-section' },
          h('div', { className: 'mp-topbar' },
            h('div', null,
              h('div', { className: 'mp-title' }, '插件市场'),
              h('div', { className: 'mp-subtitle' }, '来源: ' + (view.data ? view.data.source : '') + ' · 收录 ' + plugins.length + ' 个插件 · 黑名单 ' + blocked.length + ' 个'),
            ),
            h('button', { type: 'button', className: 'mp-btn', onClick: loadAll }, '刷新'),
          ),

          h('div', { className: 'mp-controls' },
            h('input', {
              className: 'mp-search',
              type: 'search',
              placeholder: '搜索插件名称或描述…',
              value: view.search,
              onChange: function (e) { patch({ search: e.target.value }) },
            }),
            h('div', { className: 'mp-chips' },
              CATEGORIES.map(function (c) {
                return h('button', {
                  key: c,
                  type: 'button',
                  className: 'mp-chip' + (view.category === c ? ' on' : ''),
                  onClick: function () { patch({ category: c }) },
                }, c)
              }),
            ),
            h('div', { className: 'mp-sort' },
              h('span', { className: 'mp-status' }, '排序:'),
              h('select', {
                value: view.sort,
                onChange: function (e) { patch({ sort: e.target.value }) },
              },
                h('option', { value: 'updated' }, '最近更新'),
                h('option', { value: 'stars' }, 'Stars'),
              ),
            ),
          ),

          resultNode,

          h('div', { className: 'mp-cards' },
            list.map(function (p) {
              return h(PluginCard, {
                key: p.slug,
                plugin: p,
                installedSet: installedSet,
                expanded: view.expanded,
                busy: view.busy,
                agreed: view.agreed,
                onToggle: function (slug) { patch({ expanded: view.expanded === slug ? null : slug }) },
                onAgree: function (slug, v) {
                  var agreed = Object.assign({}, view.agreed)
                  agreed[slug] = v
                  patch({ agreed: agreed })
                },
                onInstall: doInstall,
              })
            }),
          ),
          list.length === 0 ? h('div', { className: 'mp-empty' }, '没有匹配的插件') : null,

          h('div', { className: 'mp-topbar', style: { marginTop: 8 } },
            h('div', null,
              h('div', { className: 'mp-title' }, '已安装(patch 管理)'),
              h('div', { className: 'mp-subtitle' }, '仅列出由插件市场安装、受 cordis.patch.yml 管理的插件'),
            ),
          ),
          h('div', { className: 'mp-cards' },
            patchRows.map(function (r) {
              return h(InstalledRow, {
                key: r.id,
                row: r,
                busy: view.busy,
                onUninstall: doUninstall,
              })
            }),
          ),
          patchRows.length === 0 ? h('div', { className: 'mp-empty' }, '暂无由插件市场安装的插件') : null,
        )
      }

      if (typeof document !== 'undefined') {
        var style = document.createElement('style')
        style.setAttribute('data-plugin', 'dsh-marketplace')
        style.textContent = styles
        ;(document.head || document.documentElement).appendChild(style)
      }

      return {
        name: 'dsh-marketplace',
        inject: ['slots'],
        apply: function (ctx) {
          ctx.slots.inject('settings.section', function () {
            return ctx.slots.register({
              name: 'settings.section',
              id: 'dsh-marketplace',
              order: 30,
              label: '插件市场',
            }, MarketplaceSection)
          })
        },
      }
    },
  })
})()
