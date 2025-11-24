export const DEFAULT_CHAT_MODEL: string = "chat-model";

export type ChatModel = {
  id: string;
  name: string;
  description: string;
};

export const chatModels: ChatModel[] = [
  {
    id: "chat-model",
    name: "Claude Sonnet",
    description: "Advanced model with excellent reasoning and text capabilities",
  },
  {
    id: "chat-model-reasoning",
    name: "Claude Reasoning",
    description:
      "Uses advanced chain-of-thought reasoning for complex problems",
  },
];
