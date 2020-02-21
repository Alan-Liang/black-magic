import Koa from 'koa'
import Router from 'koa-router'
import serveStatic from 'koa-static'
import dotenv from 'dotenv'
import path from 'path'
import { createServer } from 'http'
import socketIO from 'socket.io'
import { fileURLToPath } from 'url'

const dirname = path.dirname(fileURLToPath(import.meta.url))

dotenv.config()

const app = new Koa()
const router = new Router()

app.use(router.routes()).use(router.allowedMethods())

const server = createServer(app.callback())
const io = socketIO(server)
server.listen(parseInt(process.env.PORT))

const players = [], rules = [], words = [], choices = [], out = [], guesses = []
const playerCount = () => players.length
const outOfGame = i => !!out[i]
const getGameId = () => String(Math.floor(Math.random() * 1024))
let stage = 'joining'
let socketId = 0, gameId = getGameId()
console.log('Game ID:', gameId)

io.on('connection', socket => {
  const thisSocketId = socketId++
  console.log('connect', thisSocketId)
  socket.on('disconnect', () => console.log('disconnect', thisSocketId))
  socket.emit('game meta', { gameId, stage })

  let id = null
  const notState = state => id === null || outOfGame(id) || stage !== state
  socket.on('resume', i => {
    if (playerCount() <= i) return socket.emit('user message', '玩家不存在')
    id = i
    let data
    switch (stage) {
      case 'joining':
        data = { players }
        break
      case 'words':
        data = { players, words: words.slice(0, -1), choices, out, guesses }
        break
      case 'choice':
        data = { players, words, choices: choices.slice(0, -1), out, guesses }
        break
      case 'ended':
        data = { players, rules, words, choices, out, guesses }
        break
      default:
        console.log(stage)
        return socket.emit('user message', 'bug')
    }
    socket.emit('resume', stage, data)
  })
  socket.on('join', (name, rule) => {
    if (!rule) return socket.emit('user message', 'no rule given')
    if (stage !== 'joining') return socket.emit('started')
    if (id === null) {
      id = players.length
      socket.emit('id', id)
      players.push(name)
      io.emit('players', players)
      console.log(`player ${id} '${name}' joining`)
    }
    rules[id] = rule
  })
  const startWords = () => {
    io.emit('words', choices[choices.length - 1] || null)
    stage = 'words'
    words.push(Array(playerCount()).fill(null))
  }
  const useWord = word => {
    const wordsNow = words[words.length - 1]
    if (wordsNow[id]) return false
    wordsNow[id] = word
    if (wordsNow.every((w, i) => !!w || outOfGame(i))) startChoice()
    return true
  }
  const startChoice = () => {
    io.emit('choose', words[words.length - 1])
    stage = 'choice'
    choices.push(Array(playerCount()).fill(null))
  }
  const choose = choice => {
    const choicesNow = choices[choices.length - 1]
    if (choicesNow[id]) return false
    choicesNow[id] = choice.map((c, i) => i === id ? '/' : outOfGame(i) ? '出局' : c ? 1 : 0)
    if (choicesNow.every((c, i) => !!c || outOfGame(i))) startWords()
    return true
  }
  const makeGuess = (who, what) => {
    guesses.push({ from: id, to: who, what })
    io.emit('guess', id, who, what)
  }
  const endGame = () => {
    stage = 'ended'
    io.emit('end', rules)
    // TODO: finalize
  }
  socket.on('start', () => {
    if (notState('joining')) return
    startWords()
  })
  socket.on('word', word => {
    if (notState('words')) return
    if (!word) return
    if (!useWord(word)) return socket.emit('user message', '已经选过啦')
  })
  socket.on('choose', choice => {
    if (notState('choice')) return
    if (!Array.isArray(choice)) return
    if (!choice[id]) return socket.emit('user message', '自己必须是true')
    if (!choose(choice)) return socket.emit('user message', '已经选过啦')
  })
  socket.on('guess', (who, what) => {
    if (id === null) return
    if (who === id) return socket.emit('user message', '不能猜自己')
    if (who === undefined || !what) return
    makeGuess(who, what)
  })
  socket.on('out', () => {
    if (id === null) return
    out[id] = true
    socket.broadcast.emit('out', id)
    if (players.filter((_, i) => !outOfGame(i)).length === 1) endGame()
  })
})

router.get('/*', serveStatic(path.resolve(dirname, '../static')))
