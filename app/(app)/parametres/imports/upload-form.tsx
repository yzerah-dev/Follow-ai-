"use client";

import { useActionState } from "react";
import { uploadImportAction, type ImportState } from "@/app/actions/imports";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/input";

export function UploadForm() {
  const [state, action, pending] = useActionState<ImportState, FormData>(uploadImportAction, {});
  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="entity">Données</Label>
        <Select id="entity" name="entity" className="w-full" defaultValue="customers">
          <option value="customers">Clients</option>
          <option value="contacts">Contacts</option>
          <option value="products">Produits</option>
          <option value="prices">Tarifs</option>
          <option value="inventory">Stocks</option>
          <option value="invoices">Factures (lignes détaillées)</option>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="file">Fichier CSV ou XLSX (15 Mo max.)</Label>
        <input id="file" name="file" type="file" accept=".csv,.xlsx,.txt" required className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-sm" />
      </div>
      {state.error ? <p role="alert" className="text-[13px] text-danger">{state.error}</p> : null}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Lecture du fichier…" : "Prévisualiser"}
      </Button>
    </form>
  );
}
