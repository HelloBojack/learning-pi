import { z } from "zod";

export const ChatRoleSchema = z.enum(["system", "user", "assistant"]);
export type ChatRole = z.infer<typeof ChatRoleSchema>;

export const ChatMessageSchema = z.object({
  role: ChatRoleSchema,
  content: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ChatRequestSchema = z.object({
  model: z.string(),
  messages: z.array(ChatMessageSchema).min(1),
  temperature: z.number().min(0).max(2).optional(),
  stream: z.literal(false).optional(),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

const ChatChoiceSchema = z.object({
  message: z.object({
    role: z.string(),
    content: z.string().nullable(),
  }),
  finish_reason: z.string().nullable().optional(),
});

export const ChatResponseSchema = z.object({
  id: z.string().optional(),
  choices: z.array(ChatChoiceSchema).min(1),
  error: z
    .object({
      message: z.string(),
      type: z.string().optional(),
      code: z.string().optional(),
    })
    .optional(),
});
export type ChatResponse = z.infer<typeof ChatResponseSchema>;
