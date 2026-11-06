/**
 * Génération d'images (visuels fond blanc, shootings lifestyle, mises en situation, merchandising).
 * Adaptateur DÉSACTIVÉ par défaut : aucun fournisseur n'est validé dans cette version.
 * Règle de fidélité : une image générative ne doit jamais modifier packaging, logo, référence, EAN,
 * textes imprimés, contenance, prix, couleurs de variante ou forme du produit. Toute image générée
 * est créée en statut "pending" et doit être validée par un humain avant usage commercial.
 *
 * Intégration « ChatGPT Work » : aucune API officielle de pilotage n'est supposée exister.
 * Un adaptateur dédié reste désactivé tant qu'une intégration officielle n'est pas vérifiée.
 */
export type ImageJobKind = "product_visual" | "lifestyle_shooting" | "merchandising_scene" | "retail_visual";

export type ImageRequest = { kind: ImageJobKind; sourceImage: Buffer | null; productName: string; brief: string };
export type ImageResult = { status: "generated"; data: Buffer; mime: string } | { status: "not_configured"; reason: string };

export interface ImageGenerationAdapter {
  readonly name: string;
  readonly enabled: boolean;
  generate(req: ImageRequest): Promise<ImageResult>;
}

export class DisabledImageAdapter implements ImageGenerationAdapter {
  readonly name = "disabled";
  readonly enabled = false;
  async generate(): Promise<ImageResult> {
    return {
      status: "not_configured",
      reason: "Aucun fournisseur de génération d'images n'est configuré. Les supports utilisent les photos sources et une composition contrôlée.",
    };
  }
}

export class ChatGptWorkAdapter implements ImageGenerationAdapter {
  readonly name = "chatgpt_work";
  readonly enabled = false;
  async generate(): Promise<ImageResult> {
    return { status: "not_configured", reason: "Adaptateur ChatGPT Work désactivé : aucune intégration officielle vérifiée." };
  }
}

export function getImageAdapter(): ImageGenerationAdapter {
  return new DisabledImageAdapter();
}
