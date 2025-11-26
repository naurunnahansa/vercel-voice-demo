"use client";

import { useState } from "react";
import { useOmniChat } from "@/hooks/use-omni-chat";
import { type VoiceProvider, PROVIDER_INFO } from "@/lib/ai/omni-voice";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { cn } from "@/lib/utils";
import { Mic, MicOff, Phone, PhoneOff } from "lucide-react";
import { chatModels } from "@/lib/ai/models";

interface OmniVoicePanelProps {
  systemPrompt?: string;
  voice?: string;
  className?: string;
  selectedModelId: string;
  onModelChange?: (modelId: string) => void;
  onTranscriptUpdate?: (transcripts: { role: string; text: string }[]) => void;
  messages?: any[];
}

export function OmniVoicePanel({
  systemPrompt,
  voice,
  className,
  selectedModelId,
  onModelChange,
  onTranscriptUpdate,
  messages,
}: OmniVoicePanelProps) {
  const [provider, setProvider] = useState<VoiceProvider>("vogent");

  const {
    isConnected,
    isConnecting,
    status,
    statusMessage,
    transcripts,
    error,
    isMuted,
    startCall,
    endCall,
    toggleMute,
  } = useOmniChat({
    provider,
    systemPrompt,
    voice,
    messages,
    onTranscriptUpdate,
    onError: (error) => {
      console.error("Voice error:", error);
    },
  });

  const isActive = isConnected || isConnecting;
  const statusStr = String(status).toLowerCase();

  const handleProviderChange = (newProvider: string) => {
    if (isActive) {
      endCall();
    }
    setProvider(newProvider as VoiceProvider);
  };

  return (
    <div className={cn("flex flex-col gap-4 p-4", className)}>
      {/* Provider and Model Selection */}
      <div className="flex justify-center gap-4">
        <Select value={provider} onValueChange={handleProviderChange} disabled={isActive}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Provider" />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(PROVIDER_INFO) as VoiceProvider[]).map((p) => (
              <SelectItem key={p} value={p}>
                {PROVIDER_INFO[p].name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={selectedModelId} onValueChange={onModelChange}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {chatModels.map((model) => (
              <SelectItem key={model.id} value={model.id}>
                {model.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Provider Badge */}
      <div className="flex justify-center">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
          {PROVIDER_INFO[provider].name}
        </span>
      </div>

      {/* Call Controls */}
      <div className="flex items-center justify-center gap-4">
        {!isActive ? (
          <Button
            onClick={startCall}
            size="lg"
            className="gap-2 bg-green-600 hover:bg-green-700"
          >
            <Phone className="h-5 w-5" />
            Start Voice Call
          </Button>
        ) : (
          <>
            <Button
              onClick={toggleMute}
              variant={isMuted ? "destructive" : "secondary"}
              size="lg"
              className="gap-2"
            >
              {isMuted ? (
                <>
                  <MicOff className="h-5 w-5" />
                  Unmute
                </>
              ) : (
                <>
                  <Mic className="h-5 w-5" />
                  Mute
                </>
              )}
            </Button>
            <Button
              onClick={endCall}
              variant="destructive"
              size="lg"
              className="gap-2"
            >
              <PhoneOff className="h-5 w-5" />
              End Call
            </Button>
          </>
        )}
      </div>

      {/* Status Display */}
      <div className="text-center">
        <div
          className={cn(
            "inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm",
            statusStr === "speaking" && "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
            statusStr === "listening" && "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
            statusStr === "thinking" && "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
            statusStr === "connecting" && "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
            statusStr === "connected" && "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
            statusStr === "idle" && "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
            statusStr === "disconnected" && "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
          )}
        >
          {(statusStr === "speaking" ||
            statusStr === "listening" ||
            statusStr === "thinking" ||
            statusStr === "connected" ||
            statusStr === "idle") && (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-current opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-current"></span>
            </span>
          )}
          {statusMessage}
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="text-center text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Transcript Display */}
      {transcripts.length > 0 && (
        <div className="max-h-60 overflow-y-auto rounded-lg border p-3 space-y-2">
          {transcripts.map((transcript, index) => (
            <div
              key={index}
              className={cn(
                "text-sm",
                transcript.role === "user"
                  ? "text-right text-muted-foreground"
                  : "text-left"
              )}
            >
              <span className="font-medium">
                {transcript.role === "user" ? "You" : "Assistant"}:
              </span>{" "}
              {transcript.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
