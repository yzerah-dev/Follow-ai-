import { test, expect, type Page } from "@playwright/test";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", "demo-follow-ai");
  await page.click("button[type=submit]");
  await page.waitForURL("/");
}

test("scénario principal : réassort → offre → supports → email → objection → commande", async ({ page }) => {
  // 1-3. Connexion et cockpit : LÉA a identifié le réassort de Maison Martin & Fils
  await login(page, "bruno@demo.follow.ai");
  const card = page.getByTestId("opportunity").filter({ hasText: "Maison Martin & Fils" }).filter({ hasText: "Réassort probable de 4 références" });
  await expect(card).toBeVisible();

  // 4-6. LÉA prépare l'offre
  await card.getByRole("button", { name: /Préparer l'offre/ }).click();
  await page.waitForURL(/\/offres\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: /Offre OF-\d{4}-\d{5}/ })).toBeVisible();
  await expect(page.getByText("À valider").first()).toBeVisible();

  // 7-8. Supports : PDF + Excel illustré, contrôles automatiques, validation
  await page.getByRole("button", { name: "Créer mes supports" }).click();
  await expect(page.getByText("2 document(s) généré(s).")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("asset")).toHaveCount(2);
  await expect(page.getByText(/Contrôles OK/)).toHaveCount(2);
  for (let i = 0; i < 2; i++) {
    await page.getByTestId("asset").getByRole("button", { name: "Valider" }).first().click();
    await expect(page.getByTestId("asset").getByText("Validé", { exact: true })).toHaveCount(i + 1);
  }
  const pdf = await page.request.get(await page.getByRole("link", { name: "Aperçu" }).first().getAttribute("href") as string);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");

  // Validation de l'offre puis rédaction de l'email
  await page.getByRole("button", { name: /Valider l'offre/ }).click();
  await expect(page.getByText("Validée", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: /Rédiger l'email avec LÉA/ }).click();
  await page.waitForURL(/\/conversations\/[0-9a-f-]{36}$/);

  // 9-11. Email personnalisé, validation humaine, envoi simulé
  const body = page.getByLabel("Message");
  await expect(body).toHaveValue(/Bonjour Monsieur Martin/);
  await expect(body).toHaveValue(/Au regard de vos derniers achats/);
  await page.getByRole("button", { name: /Valider et envoyer \(simulation\)/ }).click();
  await expect(page.getByText("Envoi simulé").first()).toBeVisible();

  // 12-14. Réponse fictive : objection prix + remise de 5 % (au-delà du plafond JONAS de 1 %)
  await page.getByRole("button", { name: "Simuler la réponse du client" }).click();
  const analysis = page.getByTestId("lea-analysis").first();
  await expect(analysis).toContainText("Objection");
  await expect(analysis).toContainText("Remise demandée 5 %");
  await expect(page.getByText("Dossier transféré au commercial responsable.")).toBeVisible();
  await expect(page.getByLabel("Message")).not.toHaveValue(/5\s?%/);

  // 15. Approbation de la réponse
  await page.getByRole("button", { name: /Valider et envoyer/ }).click();
  await expect(page.getByLabel("Message")).toHaveCount(0);

  // 16. Le client accepte → demande de commande
  await page.getByRole("button", { name: /C'est validé pour nous/ }).click();
  await page.getByRole("button", { name: "Simuler la réponse du client" }).click();
  await expect(page.getByTestId("lea-analysis").last()).toContainText("Accord / commande");
  await page.getByRole("link", { name: /^Offre OF-/ }).click();
  await page.getByRole("button", { name: /préparer la commande/ }).click();
  await expect(page.getByText(/Demande de commande CMD-\d{4}-\d{5} préparée/).first()).toBeVisible();

  // 17. Le cockpit reflète le résultat
  await page.goto("/");
  await expect(page.getByText("1 demande(s) de commande")).toBeVisible();
});

test("lecture seule : aucune action d'écriture proposée", async ({ page }) => {
  await login(page, "diane@demo.follow.ai");
  await expect(page.getByTestId("opportunity").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Préparer l'offre/ })).toHaveCount(0);
});

test("isolation : une autre entreprise ne peut pas ouvrir un client de JONAS", async ({ page, browser }) => {
  await login(page, "bruno@demo.follow.ai");
  await page.goto("/clients?q=Maison%20Martin");
  await page.getByRole("link", { name: "Maison Martin & Fils" }).click();
  await page.waitForURL(/\/clients\/[0-9a-f-]{36}$/);
  const url = page.url();
  const other = await browser.newPage();
  await login(other, "chloe@demo.follow.ai");
  await other.goto(url);
  // Le rendu en streaming peut conserver un statut HTTP 200 : on vérifie le contenu.
  await expect(other.getByRole("heading", { name: "Page introuvable" })).toBeVisible();
  await expect(other.getByText("Maison Martin & Fils")).toHaveCount(0);
  const asset = await other.request.get(url.replace("/clients/", "/api/assets/"));
  expect(asset.status()).toBe(404);
  await other.close();
});

test("mode autonome : réglé dans les paramètres, LÉA envoie seule", async ({ page }) => {
  await login(page, "alice@demo.follow.ai");
  await page.goto("/parametres");
  await page.getByLabel("Niveau d'autonomie").selectOption("autonomous");
  await page.getByLabel(/LÉA peut accorder seule une remise/).check();
  for (const d of ["Sam", "Dim"]) await page.getByLabel(d, { exact: true }).check();
  await page.getByLabel("Début").fill("00:00");
  await page.getByLabel("Fin").fill("23:59");
  await page.getByRole("button", { name: "Enregistrer l'autonomie" }).click();
  await expect(page.getByText("Autonomie de LÉA enregistrée.")).toBeVisible();

  await page.goto("/");
  await expect(page.getByText("LÉA au travail")).toBeVisible();
  await page.getByRole("button", { name: /Lancer LÉA maintenant/ }).click();
  await expect(page.getByText(/LÉA a préparé \d+ offre\(s\) : [1-9]\d* email\(s\) envoyé\(s\)/)).toBeVisible({ timeout: 60_000 });
  const sent = page.getByTestId("lea-activity").filter({ hasText: "Offre envoyée" }).first();
  await expect(sent).toBeVisible();
  await sent.getByRole("link").click();
  await page.waitForURL(/\/conversations\//);
  await expect(page.getByText("Envoyé seul par LÉA")).toBeVisible();
  await expect(page.getByText("Envoi simulé").first()).toBeVisible();

  // Interrupteur d'arrêt
  await page.goto("/parametres");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Suspendre LÉA" }).click();
  await expect(page.getByText("Suspendue").first()).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Lancer LÉA maintenant/ })).toHaveCount(0);
});
