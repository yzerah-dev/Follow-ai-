import { mockAnalyzeReply, mockChat, mockFollowup, mockMeetingProposal, mockObjectionReply, mockOfferEmail, type ChatFacts, type FollowupCtx, type MeetingCtx, type ObjectionCtx, type OfferEmailCtx } from "@/features/agent/mock-brain";
import { LlmError, type LlmProvider, type StructuredRequest, type StructuredResult } from "./types";

/** Fournisseur IA simulé : déterministe, sans appel externe, signalé « IA simulée » dans l'interface. */
export class MockProvider implements LlmProvider {
  readonly name = "mock" as const;
  readonly model = "simulation-deterministe";
  readonly simulated = true;

  async structured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    let out: unknown;
    switch (req.task) {
      case "draft_offer_email":
        out = mockOfferEmail(req.context as OfferEmailCtx);
        break;
      case "analyze_reply":
        out = mockAnalyzeReply((req.context as { text: string }).text);
        break;
      case "draft_objection_reply":
        out = mockObjectionReply(req.context as ObjectionCtx);
        break;
      case "draft_followup":
        out = mockFollowup(req.context as FollowupCtx);
        break;
      case "draft_meeting_proposal":
        out = mockMeetingProposal(req.context as MeetingCtx);
        break;
      case "lea_chat":
        out = mockChat(req.context as ChatFacts);
        break;
      default:
        throw new LlmError(`Tâche inconnue pour le fournisseur simulé : ${req.task}`);
    }
    return { data: req.schema.parse(out), usage: { inputTokens: 0, outputTokens: 0 }, provider: this.name, model: this.model, simulated: true };
  }
}
