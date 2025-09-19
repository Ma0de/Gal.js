/*
  gal.js — 轻量可扩展 Galgame 引擎
  说明:
  - 这是一个单文件纯 JS 的 galgame 引擎，所有逻辑、UI 都通过 JS 创建并管理。
  - 你可以在文件开头定义角色、背景、资源，然后编写剧情脚本（数组或 JSON）。
  - 引擎支持：背景显示/隐藏、角色显示/隐藏、角色状态（多张立绘）切换、对白、选项分支、跳转、标签、等待、播放音乐（简单 API）等。
  - 所有行为都通过脚本指令驱动，你可修改源码扩展指令或 UI。

  用法示例：
  1) 在页面中引入 gal.js（<script src="gal.js"></script>），或者把本文件直接复制到项目中。
  2) 在脚本开头定义 `RESOURCES`：角色（角色名、各状态图片）、背景、BGM 等。
  3) 设计你的剧情；编写 `SCRIPT`，调用 `const engine = new GalEngine(container)`，engine.load(RESOURCES).start(SCRIPT)
  3-1) 意思是，你可以改变 SCRIPT 来自定义你的剧情，相信有编程基础的人都能看懂 SCRIPT 吧？

  设计理念：极简但可扩展。所有 DOM 都在 container 中创建，样式可直接在 CSS 中覆盖或通过 `engine.options` 修改。
*/

// -------------------------- 配置示例（你可在此处修改/替换资源） --------------------------
const RESOURCES = {
  characters: {
    // 每个角色 key 是 id，标签 name 是显示名，states 是一个对象，key 为状态 id，对应图片 URL
    liz: {
      name: 'Liz',
      states: {
        neutral: 'assets/char/oiiao_Generally.png',
        happy: 'assets/char/oiiao_Generally.png',
        sad: 'assets/char/oiiao_Generally.png'
      }
    },
    Popo: {
      name: 'Popo',
      states: {
        neutral: 'assets/char/Popo_normal.png',
        angry: 'assets/char/Popo_normal.png'
      }
    }
  },
  backgrounds: {
    room: 'assets/bg/room.jpg',
    park: 'assets/bg/park.jpg'
  },
  bgm: {
    calm: 'assets/bgm/calm.mp3'
  }
};

// -------------------------- 场景脚本示例（可替换） --------------------------
const SCRIPT = [
  { type: 'label', id: 'start' },
  { type: 'bg', show: true, src: 'room' },
  { type: 'bgm', action: 'play', id: 'calm', loop: true },
  { type: 'char', id: 'liz', action: 'show', state: 'neutral', side: 'left' },
  { type: 'say', who: 'liz', text: '你好呀，我是 Liz。是你的新朋友！你愿意和我去公园吗？' },
  { type: 'choice', choices: [
    { text: '当然', goto: 'go_park' },
    { text: '不了，谢谢', goto: 'stay' }
  ]},
  { type: 'label', id: 'go_park' },
  { type: 'bg', show: true, src: 'park' },
  { type: 'char', id: 'liz', action: 'setState', state: 'happy' },
  { type: 'say', who: 'liz', text: '太好了，出发！' },
  { type: 'say', who: 'liz', text: '今天天气真好不是吗' },
  { type: 'end' },

  { type: 'label', id: 'stay' },
  { type: 'char', id: 'liz', action: 'setState', state: 'sad' },
  { type: 'say', who: 'liz', text: '好吧' },
  { type: 'end' }
];

// -------------------------- 引擎实现 --------------------------
class GalEngine {
  constructor(container = document.body, options = {}) {
    // container: DOM element 或 CSS selector
    if (typeof container === 'string') container = document.querySelector(container);
    if (!container) throw new Error('Container not found');
    this.container = container;
    this.options = Object.assign({
      width: 960,
      height: 540,
      textBoxHeight: 140,
      transition: 300 // ms
    }, options);

    this.resources = { characters: {}, backgrounds: {}, bgm: {} };
    this.script = [];
    this.labels = {};
    this.pc = 0; 
    this.stack = [];
    this.running = false;
    this.state = {
      bgVisible: true,
      chars: {}, // id -> {visible, state, side, el}
      bgm: null
    };

    this._buildUI();
    this._bindGlobalKeys();
  }

  // ---------------- UI 构建 ----------------
  _buildUI() {
    const c = this.container;
    c.classList.add('gal-container');
    c.style.position = 'relative';
    c.style.width = this.options.width + 'px';
    c.style.height = this.options.height + 'px';
    c.style.overflow = 'hidden';
    c.style.background = '#000';

    this.bgLayer = document.createElement('div');
    this.bgLayer.className = 'gal-bg-layer';
    Object.assign(this.bgLayer.style, {
      position: 'absolute', left: 0, top: 0, right: 0, bottom: this.options.textBoxHeight + 'px',
      transition: `opacity ${this.options.transition}ms ease`, backgroundSize: 'cover', backgroundPosition: 'center'
    });
    c.appendChild(this.bgLayer);

    this.charLayer = document.createElement('div');
    this.charLayer.className = 'gal-char-layer';
    Object.assign(this.charLayer.style, { position: 'absolute', left: 0, right: 0, top: 0, bottom: this.options.textBoxHeight + 'px', pointerEvents: 'none' });
    c.appendChild(this.charLayer);

    this.textBox = document.createElement('div');
    this.textBox.className = 'gal-textbox';
    Object.assign(this.textBox.style, {
      position: 'absolute', left: 0, right: 0, bottom: 0, height: this.options.textBoxHeight + 'px',
      background: 'rgba(0,0,0,0.6)', color: '#fff', padding: '16px', boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column', justifyContent: 'center'
    });

    this.nameLabel = document.createElement('div');
    this.nameLabel.className = 'gal-name';
    Object.assign(this.nameLabel.style, { fontWeight: '700', marginBottom: '6px' });
    this.textBox.appendChild(this.nameLabel);

    this.textContent = document.createElement('div');
    this.textContent.className = 'gal-content';
    this.textBox.appendChild(this.textContent);

    this.choiceBox = document.createElement('div');
    this.choiceBox.className = 'gal-choices';
    Object.assign(this.choiceBox.style, { marginTop: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap' });
    this.textBox.appendChild(this.choiceBox);

    c.appendChild(this.textBox);

    const style = document.createElement('style');
    style.innerHTML = `
      .gal-container img { max-width: 100%; height: auto; display: block; }
      .gal-char { position: absolute; bottom: 0; transform-origin: bottom center; transition: opacity ${this.options.transition}ms ease, transform ${this.options.transition}ms ease; }
      .gal-char.left { left: 6%; }
      .gal-char.center { left: 50%; transform: translateX(-50%); }
      .gal-char.right { right: 6%; }
    `;
    document.head.appendChild(style);
  }

  _bindGlobalKeys() {
    // 空格或点击推进
    this._onClick = (e) => {
      // 如果有选项正在显示，不响应推进
      if (this.choiceBox.childElementCount > 0) return;
      this.next();
    };
    this.container.addEventListener('click', this._onClick);
  }

  // ---------------- 资源加载与管理 ----------------
  load(resources = {}) {
    // 合并资源表（不强制预加载图片，以便自主决定）
    this.resources.characters = Object.assign({}, this.resources.characters, resources.characters || {});
    this.resources.backgrounds = Object.assign({}, this.resources.backgrounds, resources.backgrounds || {});
    this.resources.bgm = Object.assign({}, this.resources.bgm, resources.bgm || {});
    return this;
  }

  // 可选的预加载方法（简单实现）
  preloadAll(progressCb) {
    const urls = [];
    for (const c of Object.values(this.resources.characters || {})) for (const s of Object.values(c.states || {})) urls.push(s);
    for (const b of Object.values(this.resources.backgrounds || {})) urls.push(b);
    const total = urls.length; let done = 0;
    if (total === 0) return Promise.resolve();
    return new Promise((resolve) => {
      urls.forEach(u => {
        const img = new Image();
        img.onload = img.onerror = () => { done++; if (progressCb) progressCb(done, total); if (done === total) resolve(); };
        img.src = u;
      });
    });
  }

  // ---------------- 脚本执行控制 ----------------
  start(script = []) {
    this.script = script.slice();
    this._indexLabels();
    this.pc = 0;
    this.running = true;
    this.next();
    return this;
  }

  _indexLabels() {
    this.labels = {};
    this.script.forEach((cmd, i) => { if (cmd.type === 'label' && cmd.id) this.labels[cmd.id] = i; });
  }

  next() {
    if (!this.running) return;
    if (this.pc >= this.script.length) { this.running = false; return; }
    const cmd = this.script[this.pc++];
    this._execute(cmd);
  }

  jumpToLabel(id) {
    if (id in this.labels) { this.pc = this.labels[id] + 1; } else { console.warn('Label not found:', id); }
  }

  // ---------------- 指令执行 ----------------
  _execute(cmd) {
    if (!cmd || !cmd.type) return this.next();
    switch (cmd.type) {
      case 'say':
        this._cmdSay(cmd); break;
      case 'bg':
        this._cmdBg(cmd); break;
      case 'char':
        this._cmdChar(cmd); break;
      case 'choice':
        this._cmdChoice(cmd); break;
      case 'wait':
        setTimeout(() => this.next(), cmd.ms || 500); break;
      case 'label':
        this.next(); break;
      case 'jump':
        if (cmd.to) { this.jumpToLabel(cmd.to); this.next(); } else this.next(); break;
      case 'bgm':
        this._cmdBgm(cmd); break;
      case 'end':
        this.running = false; this._onEnd(); break;
      default:
        console.warn('Unknown cmd:', cmd); this.next();
    }
  }

  _onEnd() {
    // 默认在结尾隐藏交互
    this.nameLabel.textContent = '';
    this.textContent.textContent = '[游戏结束]';
  }

  // ---------------- 各类命令具体实现 ----------------
// ---------------- 各类命令具体实现 ----------------
_cmdSay(cmd) {
  const who = cmd.who || '';
  const whoName = who && this.resources.characters[who]
    ? this.resources.characters[who].name
    : (cmd.name || '');
  this.nameLabel.textContent = whoName;

  const nextCmd = this.script[this.pc];
  const hasChoiceAfter = nextCmd && nextCmd.type === 'choice';
  const hasEndAfter = nextCmd && nextCmd.type === 'end';
  
  this._typeText(cmd.text || '', () => {
    if (hasChoiceAfter) {
      this.next(); 
    } 
    else if (hasEndAfter) {
      this._waitingForClick = true; 
      this._endOnClick = () => {
        this.next(); 
        this._endOnClick = null; 
      };
    } else {
      this._waitingForClick = true;
    }
  });
}

_typeText(text, cb) {
  this.choiceBox.innerHTML = '';
  this.textContent.textContent = '';
  
  let displayedText = '';
  let i = 0;
  const tick = () => {
    if (i >= text.length) { 
      cb(); 
      return; 
    }
    displayedText = text.substring(0, i + 1);
    this.textContent.textContent = displayedText;
    i++;
    setTimeout(tick, 16);
  };
  tick();
}


  _cmdBg(cmd) {
    // { type: 'bg', show: true/false, src: '<bg id>' }
    if ('show' in cmd) {
      this.state.bgVisible = !!cmd.show;
      this.bgLayer.style.opacity = this.state.bgVisible ? '1' : '0';
    }
    if (cmd.src) {
      const url = this.resources.backgrounds[cmd.src] || cmd.src;
      this._setBgImage(url);
    }
    setTimeout(() => this.next(), cmd.wait || this.options.transition);
  }

  _setBgImage(url) {
    this.bgLayer.style.backgroundImage = url ? `url('${url}')` : '';
  }

  _cmdChar(cmd) {
    // 可 actions: show, hide, setState
    const id = cmd.id;
    if (!id) { this.next(); return; }
    const action = cmd.action || 'show';
    if (action === 'show') {
      const state = cmd.state || Object.keys(this.resources.characters[id]?.states || {})[0] || null;
      const side = cmd.side || 'center';
      this._showChar(id, state, side);
      setTimeout(() => this.next(), cmd.wait || this.options.transition);
    } else if (action === 'hide') {
      this._hideChar(id);
      setTimeout(() => this.next(), cmd.wait || this.options.transition);
    } else if (action === 'setState') {
      this._setCharState(id, cmd.state);
      setTimeout(() => this.next(), cmd.wait || this.options.transition);
    } else {
      console.warn('未知 char action', action); this.next();
    }
  }

  _getCharEl(id) {
    return this.charLayer.querySelector(`.gal-char[data-id="${id}"]`);
  }

  _showChar(id, state, side = 'center') {
    const resChar = this.resources.characters[id];
    if (!resChar) { console.warn('角色未定义:', id); return; }
    const url = resChar.states[state] || state;
    let el = this._getCharEl(id);
    if (!el) {
      el = document.createElement('img');
      el.className = `gal-char ${side}`;
      el.dataset.id = id;
      Object.assign(el.style, { opacity: 0, pointerEvents: 'auto', maxHeight: '100%', height: '100%' });
      this.charLayer.appendChild(el);
      el.style.bottom = '0px';
    } else {
      el.classList.remove('left','center','right'); el.classList.add(side);
    }
    el.src = url || '';
    this.state.chars[id] = Object.assign(this.state.chars[id] || {}, { visible: true, state, side, el });
    requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateY(0)'; });
  }

  _hideChar(id) {
    const el = this._getCharEl(id);
    if (!el) return;
    el.style.opacity = '0';
    this.state.chars[id] = Object.assign(this.state.chars[id] || {}, { visible: false });
    setTimeout(() => { if (el && el.parentNode) el.parentNode.removeChild(el); }, this.options.transition);
  }

  _setCharState(id, state) {
    const resChar = this.resources.characters[id];
    if (!resChar) { console.warn('角色未定义:', id); return; }
    const url = resChar.states[state] || state;
    const el = this._getCharEl(id);
    if (el) el.src = url || '';
    this.state.chars[id] = Object.assign(this.state.chars[id] || {}, { state });
  }

  _cmdChoice(cmd) {
    // cmd.choices: [{text, goto (label), callback (optional)}]
    this.choiceBox.innerHTML = '';
    const choices = cmd.choices || [];
    choices.forEach((ch, i) => {
      const btn = document.createElement('button');
      btn.textContent = ch.text || `选项 ${i+1}`;
      Object.assign(btn.style, { padding: '8px 12px', cursor: 'pointer' });
      btn.addEventListener('click', () => {
        this.choiceBox.innerHTML = '';
        if (ch.callback) ch.callback();
        if (ch.goto) { this.jumpToLabel(ch.goto); this.next(); } else { this.next(); }
      });
      this.choiceBox.appendChild(btn);
    });
  }

  _cmdBgm(cmd) {
    // {type:'bgm', action: 'play'|'stop'|'pause', id: '<bgm id>'}
    const action = cmd.action || 'play';
    if (action === 'play') {
      const id = cmd.id;
      const url = this.resources.bgm[id] || id;
      if (!this._bgmAudio) this._bgmAudio = new Audio();
      this._bgmAudio.src = url;
      this._bgmAudio.loop = !!cmd.loop;
      this._bgmAudio.play().catch(e => console.warn('BGM play failed', e));
      this.state.bgm = id;
    } else if (action === 'stop') {
      if (this._bgmAudio) { this._bgmAudio.pause(); this._bgmAudio.currentTime = 0; }
      this.state.bgm = null;
    } else if (action === 'pause') {
      if (this._bgmAudio) this._bgmAudio.pause();
    }
    setTimeout(() => this.next(), 100);
  }

  // ---------------- 开放 API ----------------
  defineCharacters(chars) { this.resources.characters = Object.assign({}, this.resources.characters, chars); }
  defineBackgrounds(bgs) { this.resources.backgrounds = Object.assign({}, this.resources.backgrounds, bgs); }
  defineBgm(bgms) { this.resources.bgm = Object.assign({}, this.resources.bgm, bgms); }

  playScript(script) { return this.start(script); }
  stop() { this.running = false; }
}

// 将引擎暴露到全局，方便在控制台或其它脚本中操作
window.GalEngine = GalEngine;

// -------------------------- 自动运行 --------------------------
// 如果页面上存在 id 为 `gal-root` 的元素，则自动加载示例资源并开始剧本。
(function autoRunExample() {
  try {
    const root = document.getElementById('gal-root');
    if (!root) return;
    const engine = new GalEngine(root);
    engine.load(RESOURCES);
    // 预加载图片可选
    engine.preloadAll(() => {}).then(() => engine.start(SCRIPT));
    // 将 engine 赋给全局，便于调试
    window.gal = engine;
  } catch (e) { console.warn('gal auto run failed', e); }
})();
