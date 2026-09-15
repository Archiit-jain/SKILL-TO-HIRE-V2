import { Fragment, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "@/lib/api";
import { AnalysisResult, ChatMessage } from "@/types";
import { Send, Bot, User, Sparkles } from "lucide-react";

interface AssistantPageProps {
  analysisResult: AnalysisResult | null;
}

const MAX_QUESTION_CHARS = 1000;

/** Shown whenever the server reports Gemini phrasing is enabled (security remediation P1, D-9). */
const GEMINI_DISCLOSURE =
  "When AI phrasing is on, your question and the relevant analysis facts (with contact details removed) are sent to Google Gemini to word the answer. Scores and skill ratings always come from Skill2Hire's rules.";

// crypto.randomUUID only exists in secure contexts (https or localhost).
let counter = 0;
const newId = () => globalThis.crypto?.randomUUID?.() ?? `msg-${Date.now()}-${counter++}`;

function starterPrompts(result: AnalysisResult | null): string[] {
  const partial = result?.partialSkills[0]?.skill;
  return [
    "What skills should I improve first?",
    partial ? `Why is my ${partial} skill only Partial?` : "How was my match score calculated?",
    "How can I strengthen my resume for this role?",
    "What should I learn to become job-ready?",
  ];
}

/**
 * Renders **bold** as <strong> by building React elements - never via innerHTML - so assistant text
 * (which may come from an LLM) cannot inject markup or scripts.
 */
function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
          <strong key={i}>{part.slice(2, -2)}</strong>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        )
      )}
    </>
  );
}

export function AssistantPage({ analysisResult }: AssistantPageProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [geminiOn, setGeminiOn] = useState(false);

  const isDemo = !!analysisResult?.demo;

  useEffect(() => {
    // The sample assistant is always rules-only, so there is no mode to ask about.
    if (isDemo) return;
    let active = true;
    api
      .assistantStatus()
      .then((s) => active && setGeminiOn(s.mode === "gemini"))
      .catch(() => undefined); // status is informational; the rules assistant works either way
    return () => {
      active = false;
    };
  }, [isDemo]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  const handleSend = async (prompt?: string) => {
    const text = (prompt ?? input).trim().slice(0, MAX_QUESTION_CHARS);
    if (!text || isTyping) return;

    setMessages((prev) => [...prev, { id: newId(), role: "user", content: text }]);
    setInput("");
    setIsTyping(true);

    try {
      const reply = isDemo ? await api.demoChat(text) : await api.chat(text, analysisResult?.id);
      setMessages((prev) => [
        ...prev,
        { id: newId(), role: "assistant", content: reply.content, sources: reply.sources },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: newId(),
          role: "assistant",
          content: err instanceof Error ? `Sorry, I couldn't answer that: ${err.message}` : "Sorry, something went wrong.",
        },
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-8 h-full flex flex-col">
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">Career Assistant</h1>
        <p className="text-slate-600 mt-1">
          Ask questions about your resume, target role, skill gaps, and improvement plan.
        </p>
        {analysisResult && (
          <p className="text-xs text-slate-500 mt-2">
            Answering from: {analysisResult.resumeName} vs {analysisResult.jdTitle}
          </p>
        )}
        {isDemo && (
          <p className="text-xs text-cyan-800 bg-cyan-50 border border-cyan-200 rounded-md px-3 py-2 mt-2">
            Sample mode: answers come from Skill2Hire's rules about the synthetic sample analysis. Nothing you type is saved.
          </p>
        )}
        <p className="text-xs text-slate-500 mt-2">
          Answers are built from your analysis. The assistant can't change a score, a rating or the evidence.
        </p>
        {geminiOn && (
          <p className="text-xs text-slate-500 mt-2" data-testid="gemini-disclosure">
            {GEMINI_DISCLOSURE}
          </p>
        )}
      </div>

      {messages.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center">
          <div className="w-16 h-16 bg-slate-900 rounded-2xl flex items-center justify-center mb-6">
            <Bot className="w-8 h-8 text-cyan-400" />
          </div>
          <h2 className="text-xl font-semibold text-slate-900 mb-4">How can I help you today?</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full max-w-2xl">
            {starterPrompts(analysisResult).map((prompt) => (
              <Button
                key={prompt}
                variant="outline"
                className="justify-start text-left border-slate-200 hover:border-cyan-300 hover:bg-cyan-50 whitespace-normal h-auto py-3"
                onClick={() => handleSend(prompt)}
              >
                <Sparkles className="w-4 h-4 mr-2 text-cyan-600 shrink-0" />
                {prompt}
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <ScrollArea className="flex-1 mb-4 min-h-0">
          <div className="space-y-4 pr-3">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex gap-3 ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {message.role === "assistant" && (
                  <div className="w-8 h-8 bg-slate-900 rounded-lg flex items-center justify-center shrink-0">
                    <Bot className="w-4 h-4 text-cyan-400" />
                  </div>
                )}
                <div
                  className={`max-w-[80%] rounded-2xl p-4 ${
                    message.role === "user"
                      ? "bg-slate-900 text-white"
                      : "bg-white border border-slate-200"
                  }`}
                >
                  <p className="whitespace-pre-line text-sm break-words">
                    <RichText text={message.content} />
                  </p>
                  {message.sources && message.sources.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-slate-200">
                      <p className="text-xs text-slate-400 mb-2">Sources:</p>
                      <div className="flex flex-wrap gap-2">
                        {message.sources.map((source) => (
                          <Badge key={source} variant="secondary" className="text-xs">
                            {source}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                {message.role === "user" && (
                  <div className="w-8 h-8 bg-cyan-500 rounded-lg flex items-center justify-center shrink-0">
                    <User className="w-4 h-4 text-white" />
                  </div>
                )}
              </div>
            ))}
            {isTyping && (
              <div className="flex gap-3">
                <div className="w-8 h-8 bg-slate-900 rounded-lg flex items-center justify-center">
                  <Bot className="w-4 h-4 text-cyan-400" />
                </div>
                <div className="bg-white border border-slate-200 rounded-2xl p-4">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" />
                    <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:0.2s]" />
                    <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce [animation-delay:0.4s]" />
                  </div>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>
      )}

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
      >
        <Input
          placeholder="Ask about your resume, skills, or career path..."
          value={input}
          maxLength={MAX_QUESTION_CHARS}
          onChange={(e) => setInput(e.target.value)}
          className="flex-1"
          aria-label="Your question"
        />
        <Button
          type="submit"
          className="bg-slate-900 hover:bg-slate-800 text-white"
          disabled={!input.trim() || isTyping}
          aria-label="Send"
        >
          <Send className="w-4 h-4" />
        </Button>
      </form>
    </div>
  );
}
