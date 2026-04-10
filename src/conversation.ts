/**
 * Conversation history manager.
 * Stores recent messages per chat for multi-turn context.
 * Persists to disk (JSON) between restarts.
 */

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	unlinkSync,
} from "node:fs"
import { writeFile } from "node:fs/promises"
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

const MIN_MAX_MESSAGES = 1
const MAX_MAX_MESSAGES = 500

/** Restrictive file permissions for chat history */
const DIR_MODE = 0o700
const FILE_MODE = 0o600

const DEFAULT_CONFIG: ConversationConfig = {
	maxMessages: 20,
	dataDir: join(homedir(), ".openclaw", "telegram-userbot"),
	systemPrompts: {},
	defaultSystemPrompt: "",
}

/** In-memory store: chatId → messages[] */
const conversations = new Map<string, ConversationMessage[]>()

/** Reverse map: sanitized filename → original chatId */
const filenameToChat = new Map<string, string>()

let _config: ConversationConfig = { ...DEFAULT_CONFIG }

/** Whether disk persistence is available */
let _persistenceEnabled = true

/** Debounce timers for disk writes */
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()
const SAVE_DEBOUNCE_MS = 1000

/** Reset all state — for testing only */
export function resetConversations(): void {
	conversations.clear()
	filenameToChat.clear()
	for (const timer of saveTimers.values()) clearTimeout(timer)
	saveTimers.clear()
	_persistenceEnabled = true
}

export function initConversations(raw: Record<string, any> = {}): void {
	resetConversations()
	const rawMax = Number(raw.maxMessages ?? DEFAULT_CONFIG.maxMessages)
	_config = {
		maxMessages: Number.isNaN(rawMax)
			? DEFAULT_CONFIG.maxMessages
			: Math.max(MIN_MAX_MESSAGES, Math.min(MAX_MAX_MESSAGES, rawMax)),
		dataDir: String(raw.dataDir || DEFAULT_CONFIG.dataDir),
		systemPrompts: (raw.systemPrompts as Record<string, string>) || {},
		defaultSystemPrompt: String(raw.defaultSystemPrompt || ""),
	}

	try {
		// Ensure data dir exists with restrictive permissions
		if (!existsSync(_config.dataDir)) {
			mkdirSync(_config.dataDir, { recursive: true, mode: DIR_MODE })
		}

		// Load persisted conversations
		loadFromDisk()
	} catch (error) {
		console.warn(
			`Conversation persistence disabled: unable to use data directory "${_config.dataDir}".`,
			error,
		)
		_persistenceEnabled = false
	}
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

	// Track filename mapping
	filenameToChat.set(sanitizeFilename(chatId), chatId)

	// Debounced persist — avoids blocking on every message
	if (_persistenceEnabled) {
		debouncedSave(chatId)
	}
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

	// Cancel any pending debounced save
	const timer = saveTimers.get(chatId)
	if (timer) {
		clearTimeout(timer)
		saveTimers.delete(chatId)
	}

	const filePath = join(_config.dataDir, `${sanitizeFilename(chatId)}.json`)
	try {
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

/** Validate that an object conforms to ConversationMessage shape */
function isValidMessage(msg: unknown): msg is ConversationMessage {
	if (typeof msg !== "object" || msg === null) return false
	const m = msg as Record<string, unknown>
	return (
		(m.role === "user" || m.role === "assistant") &&
		typeof m.sender === "string" &&
		typeof m.text === "string" &&
		typeof m.timestamp === "number"
	)
}

function debouncedSave(chatId: string): void {
	const existing = saveTimers.get(chatId)
	if (existing) clearTimeout(existing)

	saveTimers.set(
		chatId,
		setTimeout(() => {
			saveToDisk(chatId)
			saveTimers.delete(chatId)
		}, SAVE_DEBOUNCE_MS),
	)
}

async function saveToDisk(chatId: string): Promise<void> {
	try {
		const filePath = join(_config.dataDir, `${sanitizeFilename(chatId)}.json`)
		const messages = conversations.get(chatId) || []
		const data = { chatId, messages }
		await writeFile(filePath, JSON.stringify(data, null, 2), { mode: FILE_MODE })
	} catch {
		// Best-effort persistence
	}
}

function loadFromDisk(): void {
	if (!existsSync(_config.dataDir)) return

	let files: string[]
	try {
		files = readdirSync(_config.dataDir)
	} catch {
		return
	}

	for (const file of files) {
		if (!file.endsWith(".json")) continue

		const filePath = join(_config.dataDir, file)
		try {
			const raw = JSON.parse(readFileSync(filePath, "utf-8"))

			// New format: { chatId, messages }
			if (raw?.chatId && Array.isArray(raw.messages)) {
				const valid = raw.messages.filter(isValidMessage)
				const trimmed = valid.slice(-_config.maxMessages)
				conversations.set(raw.chatId, trimmed)
				filenameToChat.set(file.replace(".json", ""), raw.chatId)
				continue
			}

			// Legacy format: bare array — use filename as best-effort chatId
			if (Array.isArray(raw)) {
				const chatId = file.replace(".json", "")
				const valid = raw.filter(isValidMessage)
				const trimmed = valid.slice(-_config.maxMessages)
				conversations.set(chatId, trimmed)
			}
		} catch {
			// Skip corrupt files, continue loading others
		}
	}
}
