/**
 * Conversation history manager.
 * Stores recent messages per chat for multi-turn context.
 * Persists to disk (JSON) between restarts.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export interface ConversationMessage {
	role: "user" | "assistant"
	sender: string
	text: string
	timestamp: number
	messageId?: number
}

export interface ConversationConfig {
	/** Max messages to keep per chat (default: 20) */
	maxMessages: number
	/** Data directory for persistence (default: ~/.openclaw/telegram-userbot) */
	dataDir: string
	/** System prompt per chat override */
	systemPrompts: Record<string, string>
	/** Default system prompt */
	defaultSystemPrompt: string
}

const DEFAULT_CONFIG: ConversationConfig = {
	maxMessages: 20,
	dataDir: join(homedir(), ".openclaw", "telegram-userbot"),
	systemPrompts: {},
	defaultSystemPrompt: "",
}

/** In-memory store: chatId → messages[] */
const conversations = new Map<string, ConversationMessage[]>()

let _config: ConversationConfig = { ...DEFAULT_CONFIG }
let _loaded = false

export function initConversations(raw: Record<string, any> = {}): void {
	_config = {
		maxMessages: Number(raw.maxMessages ?? DEFAULT_CONFIG.maxMessages),
		dataDir: String(raw.dataDir || DEFAULT_CONFIG.dataDir),
		systemPrompts: (raw.systemPrompts as Record<string, string>) || {},
		defaultSystemPrompt: String(raw.defaultSystemPrompt || ""),
	}

	// Ensure data dir exists
	if (!existsSync(_config.dataDir)) {
		mkdirSync(_config.dataDir, { recursive: true })
	}

	// Load persisted conversations
	loadFromDisk()
	_loaded = true
}

/** Add a message to conversation history */
export function addMessage(chatId: string, message: ConversationMessage): void {
	if (!conversations.has(chatId)) {
		conversations.set(chatId, [])
	}

	const messages = conversations.get(chatId)!
	messages.push(message)

	// Trim to max
	if (messages.length > _config.maxMessages) {
		messages.splice(0, messages.length - _config.maxMessages)
	}

	// Persist async (non-blocking)
	saveToDisk(chatId)
}

/** Get conversation history for a chat */
export function getHistory(chatId: string): ConversationMessage[] {
	return conversations.get(chatId) || []
}

/** Get system prompt for a chat */
export function getSystemPrompt(chatId: string): string {
	return _config.systemPrompts[chatId] || _config.defaultSystemPrompt
}

/** Build context string for AI — includes system prompt + recent messages */
export function buildContext(chatId: string): string {
	const systemPrompt = getSystemPrompt(chatId)
	const messages = getHistory(chatId)

	const parts: string[] = []

	if (systemPrompt) {
		parts.push(`[System: ${systemPrompt}]`)
	}

	if (messages.length > 0) {
		parts.push("[Conversation history:]")
		for (const msg of messages) {
			const prefix = msg.role === "user" ? msg.sender : "Assistant"
			parts.push(`${prefix}: ${msg.text}`)
		}
	}

	return parts.join("\n")
}

/** Clear history for a chat */
export function clearHistory(chatId: string): void {
	conversations.delete(chatId)
	const filePath = join(_config.dataDir, `${sanitizeFilename(chatId)}.json`)
	try {
		const { unlinkSync } = require("node:fs")
		unlinkSync(filePath)
	} catch {}
}

/** Get conversation stats */
export function getStats(): { chats: number; totalMessages: number } {
	let totalMessages = 0
	for (const messages of conversations.values()) {
		totalMessages += messages.length
	}
	return { chats: conversations.size, totalMessages }
}

// --- Persistence ---

function sanitizeFilename(chatId: string): string {
	return chatId.replace(/[^a-zA-Z0-9_-]/g, "_")
}

function saveToDisk(chatId: string): void {
	try {
		const filePath = join(_config.dataDir, `${sanitizeFilename(chatId)}.json`)
		const messages = conversations.get(chatId) || []
		writeFileSync(filePath, JSON.stringify(messages, null, 2))
	} catch {
		// Silently fail — persistence is best-effort
	}
}

function loadFromDisk(): void {
	try {
		if (!existsSync(_config.dataDir)) return

		const { readdirSync } = require("node:fs")
		const files: string[] = readdirSync(_config.dataDir)

		for (const file of files) {
			if (!file.endsWith(".json")) continue

			const chatId = file.replace(".json", "").replace(/_/g, ":")
			const filePath = join(_config.dataDir, file)
			const data = JSON.parse(readFileSync(filePath, "utf-8"))

			if (Array.isArray(data)) {
				// Trim to current max
				const trimmed = data.slice(-_config.maxMessages)
				conversations.set(chatId, trimmed)
			}
		}
	} catch {
		// Silently fail — start fresh
	}
}
