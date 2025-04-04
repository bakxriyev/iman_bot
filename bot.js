import dotenv from 'dotenv'
dotenv.config()

import TelegramBot from 'node-telegram-bot-api'
import axios from 'axios'
import moment from 'moment'
import fs from 'fs'
import path from 'path'
import cron from 'node-cron'
import xlsx from 'xlsx'

// Bot tokenini environment variable orqali olish
const token = process.env.TELEGRAM_BOT_TOKEN
if (!token) {
  console.error("Telegram Bot Token not provided!")
  process.exit(1)
}

const backendUrl = "https://backend.imanakhmedovna.uz"

// Tekshirish uchun saytlar ro'yxati
const websites = [
  { name: "Dangasalik", url: "https://dangasalikni-yengish.imanakhmedovna.uz" },
  { name: "Maqsadlarga erishish", url: "https://maqsadlarga-erishish.imanakhmedovna.uz" },
  { name: "Intizom", url: "https://intizomni.shakillantirish.imanakhmedovna.uz" }
]

// Bot instansiyasini yaratish
const bot = new TelegramBot(token, { polling: true })

// Guruh chat ID larini saqlash uchun Set
const groupChatIds = new Set()

// Bot haqidagi ma'lumotlarni olish (bot id sini aniqlash uchun)
let botInfo = null
bot.getMe()
  .then(info => {
    botInfo = info
    console.log("Bot info:", botInfo)
  })
  .catch(err => console.error(err))

// Guruhga qo'shilganda, agar bot yangi a'zo sifatida kiritilsa, guruh chat ID sini saqlaymiz
bot.on("new_chat_members", (msg) => {
  if (!botInfo) return
  const newMembers = msg.new_chat_members
  if (newMembers.some(member => member.id === botInfo.id)) {
    groupChatIds.add(msg.chat.id)
    console.log(`Bot added to group "${msg.chat.title}" (${msg.chat.id})`)
  }
})

// Agar bot guruhdan chiqarilsa, ID ni olib tashlaymiz
bot.on("left_chat_member", (msg) => {
  if (!botInfo) return
  if (msg.left_chat_member.id === botInfo.id) {
    groupChatIds.delete(msg.chat.id)
    console.log(`Bot removed from group "${msg.chat.title}" (${msg.chat.id})`)
  }
})

// /start buyrug'ini boshqarish
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id
  bot.sendMessage(chatId, "Assalomu alaykum! Ma'lumotlarni olish uchun /malumot buyrug'ini yuboring.")
})

// /malumot buyrug'ini boshqarish: ma'lumotlarni olish, Excel faylini yaratish va yuborish
bot.onText(/\/malumot/, async (msg) => {
  const chatId = msg.chat.id
  const isGroup = msg.chat.type === "group" || msg.chat.type === "supergroup"

  try {
    // "Loading" xabarini yuborish
    const loadingMessage = await bot.sendMessage(chatId, "Ma'lumotlar yuklanmoqda...")

    // Hozirgi vaqtni olish
    const currentTime = moment().format("HH:mm:ss DD.MM.YYYY")

    // Backend'dan foydalanuvchilar ma'lumotini olish
    const response = await axios.get(`${backendUrl}/users`)
    const users = response.data

    // Excel fayl nomini vaqt bilan shakllantirish
    const excelFileName = `users_${moment().format("DDMMYYYY_HHmmss")}.xlsx`
    
    // Foydalanuvchilarni Excel faylga yozish
    const wb = xlsx.utils.book_new()
    const ws = xlsx.utils.json_to_sheet(users)
    xlsx.utils.book_append_sheet(wb, ws, "Users")
    
    // Excel faylini saqlash
    const tempFilePath = path.join(process.cwd(), excelFileName)
    xlsx.writeFile(wb, tempFilePath)

    // Xabar matnini yaratish
    let messageText = `📊 *Ma'lumotlar* (${currentTime})\n\n`
    messageText += `👥 Foydalanuvchilar soni: *${users.length}*\n\n`
    if (isGroup) {
      messageText += `Guruh nomi: *${msg.chat.title}*\n`
      messageText += `Guruh a'zolari: *${msg.chat.members_count || "Aniqlanmadi"}*\n\n`
    }
    messageText += `📥 Excel fayl avtomatik tarzda jo'natiladi.\n\n`

    // Saytlar holatini tekshirish
    const websiteStatuses = await Promise.all(
      websites.map(async (site) => {
        try {
          const res = await axios.get(site.url, { timeout: 5000 })
          return `${site.name}: ${res.status === 200 ? "✅" : "🚫"}`
        } catch (err) {
          return `${site.name}: 🚫`
        }
      })
    )
    messageText += `📡 *Sayt holati:*\n` + websiteStatuses.join("\n")

    // Loading xabarini o'chirish
    await bot.deleteMessage(chatId, loadingMessage.message_id)

    // Ma'lumot matnini yuborish
    await bot.sendMessage(chatId, messageText, { parse_mode: "Markdown" })

    // Excel faylini hujjat sifatida yuborish
    await bot.sendDocument(chatId, tempFilePath)

    // Vaqtinchalik faylni o'chirish
    fs.unlink(tempFilePath, (err) => {
      if (err) console.error("Temporary file removal error:", err)
    })

  } catch (error) {
    console.error("Error:", error)
    bot.sendMessage(chatId, "Xatolik yuz berdi. Iltimos, keyinroq qayta urinib ko'ring.")
  }
})

// Polling xatoliklarini boshqarish
bot.on("polling_error", (error) => {
  console.error("Polling error:", error)
})

// Har soat boshida avtomatik xabar yuborish: saqlangan barcha guruh chat IDlariga yuboriladi
cron.schedule('0 * * * *', async () => {
  const currentTime = moment().format("HH:mm:ss DD.MM.YYYY")
  let autoMessage = `Avtomatik xabar: Hozirgi vaqt: ${currentTime}\n\n`
  const websiteStatuses = await Promise.all(
    websites.map(async (site) => {
      try {
        const res = await axios.get(site.url, { timeout: 5000 })
        return `${site.name}: ${res.status === 200 ? "✅" : "🚫"}`
      } catch (err) {
        return `${site.name}: 🚫`
      }
    })
  )
  autoMessage += `📡 *Sayt holati:*\n` + websiteStatuses.join("\n")
  // Har bir guruhga yuborish
  for (let chatId of groupChatIds) {
    try {
      await bot.sendMessage(chatId, autoMessage, { parse_mode: "Markdown" })
      console.log(`Hourly message sent to group ${chatId}`)
    } catch (error) {
      console.error(`Error sending hourly message to ${chatId}:`, error)
    }
  }
})

console.log("Bot started successfully!")
