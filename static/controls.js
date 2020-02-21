const socket = io()
const storageKey = '__bmg-'
const domCache = {}
const $ = sel => {
  let el = domCache[sel]
  if (!el) {
    el = document.querySelector(sel)
    domCache[sel] = el
  }
  return el
}
$.noCache = sel => document.querySelector(sel)
HTMLElement.prototype.hide = function () { return this.classList.add('hidden'), this }
HTMLElement.prototype.show = function () { return this.classList.remove('hidden'), this }

const bmg = window.bmg = {
  _esc: val => val.replace(/</g, '&lt;'.replace(/>/g, '&gt;')),
  gameId: null,
  id: null,
  _players: [],
  get players () { return bmg._players },
  set players (val) {
    this._players = val
    this._updatePlayers()
  },
  _updatePlayers () {
    $('#players').show().innerHTML = this.players.map(p => `<li>${bmg._esc(p)}</li>`).join('')
  },
  rules: null,
  words: [],
  choices: [],
  _updateChoices () {
    html = '<tr><th></th>'
    html += bmg.players.map(p => `<th>${bmg._esc(p)}</th>`).join('')
    html += '</tr>'
    html += bmg.choices.map((c, i) => bmg.words[i].map((w, j) => w ? `<tr><td>${bmg._esc(w)}</td>` + bmg.players.map((_, k) => `<td>${c[k] ? c[k][j] : '出局'}</td>`).join('') + '</tr>' : '').join('')).join('')
    $('#data-table').show().innerHTML = html
  },
  guesses: [],
  guess (from, to, what) {
    if (arguments.length === 0) {
      const who = parseInt($('#guess-who').value), what = $('#guess-what').value
      if (!(who >= 1 && who <= bmg.players.length)) return bmg.message('玩家无效')
      if (!what) return bmg.message('说点什么')
      socket.emit('guess', who - 1, what)
    } else {
      bmg.guesses.push({ from, to, what })
      bmg._updateGuesses()
    }
  },
  _updateGuesses () {
    $('#guesses').show().innerHTML = bmg.guesses.map(({ from, to, what }) => `<li>${bmg._esc(bmg.players[from])} → ${bmg._esc(bmg.players[to])}: ${bmg._esc(what)}</li>`).join('')
  },
  out: [],
  dead: false,
  die (id) {
    if (arguments.length === 0) {
      if (confirm('确认？')) {
        socket.emit('out')
        bmg.out[bmg.id] = true
        this.dead = true
      }
    } else {
      bmg.out[id] = true
      bmg.message(`${bmg._esc(bmg.players[id])}已经出局。`)
    }
  },
  _stage: null,
  get stage () { return bmg._stage },
  set stage (val) {
    const oldStage = bmg.stage
    bmg._stage = val
    bmg._updateStage(val, oldStage)
  },
  _updateStage (stage) {
    $('#wait').hide()
    $('#guess').show()
    const noHole = arr => {
      const arr1 = []
      for (let i = 0; i < bmg.players.length; i++) arr1[i] = arr[i]
      return arr1
    }
    switch (stage) {
      case 'words':
        $('#choice').hide()
        $('#words').show()
        this._updateChoices()
        break
      case 'choice':
        $('#choice').show()
        $('#choose-content').innerHTML = bmg.words[this.words.length - 1].map((a, b) => [a, b]).filter((_, i) => i !== bmg.id && !bmg.out[i])
          .map(([w, i]) => `<input id="bmg-choose-${i}" type="checkbox">${bmg._esc(w)}<br>`).join('')
        $('#words').hide()
        break
      case 'ended':
        $('#choice').hide()
        $('#words').hide()
        $('#ended').show().innerText = '\'' + bmg._esc(bmg.players[noHole(bmg.out).map((o, i) => [o, i]).find(o => !o[0])[1]]) + '\' 活到了最后'
        $('#guess').hide()
      case 'joining':
      default:
        break
    }
  },
  message (msg) { $('#message').show().innerText = msg },
  join () {
    const name = $('#name').value, rule = $('#rule').value
    if (!name || !rule) return bmg.message('所有项目均为必填')
    socket.emit('join', name, rule)
    $('#join').hide()
    $('#wait').show()
  },
  choose () {
    if (bmg.dead) return bmg.message('您已经出局')
    const data = []
    for (let id of bmg.players.keys()) {
      if (id === bmg.id) data[id] = true
      else if (!bmg.out[id]) data[id] = $.noCache(`#bmg-choose-${id}`).checked
    }
    socket.emit('choose', data)
    $('#choice').hide()
    $('#wait').show()
  },
  word () {
    if (bmg.dead) return bmg.message('您已经出局')
    const word = $('#word').value
    if (!word) return bmg.message('请填写')
    socket.emit('word', word)
    $('#words').hide()
    $('#wait').show()
  },
}

socket.on('user message', msg => bmg.message(msg))
socket.on('game meta', ({ gameId, stage }) => {
  if (localStorage[storageKey + 'gameId'] === gameId && localStorage[storageKey + 'id']) {
    return socket.emit('resume', parseInt(localStorage[storageKey + 'id']))
  }
  localStorage[storageKey + 'gameId'] = gameId
  delete localStorage[storageKey + 'id']
  if (stage === 'joining') $('#join').show()
  else $('#started').show()
})
socket.on('resume', (stage, data) => {
  bmg.players = data.players
  bmg.id = parseInt(localStorage[storageKey + 'id'])
  bmg.words = data.words || []
  bmg.choices = data.choices || []
  bmg.out = data.out || []
  bmg.guesses = data.guesses || []
  bmg._updateChoices()
  bmg._updateGuesses()
  if (stage === 'ended') {
    bmg.players = bmg.players.map((p, i) => `${p}: ${data.rules[i]}`)
  }
  bmg.stage = stage
})
socket.on('id', id => {
  localStorage[storageKey + 'id'] = id
  bmg.id = id
})
socket.on('started', () => $('#started').show())
socket.on('players', p => bmg.players = p)
socket.on('words', choices => {
  if (choices) bmg.choices.push(choices)
  bmg.stage = 'words'
})
socket.on('choose', words => {
  bmg.words.push(words)
  bmg.stage = 'choice'
})
socket.on('guess', (from, to, what) => bmg.guess(from, to, what))
socket.on('out', id => bmg.die(id))
socket.on('end', rules => {
  bmg.stage = 'ended'
  bmg.players = bmg.players.map((p, i) => `${p}: ${rules[i]}`)
})
