"use client";

import { useId, useState, type FormEvent } from "react";
import { Check, ExternalLink, Eye, EyeOff, Info } from "lucide-react";
import { toast } from "sonner";

import { GithubIcon } from "@/components/icons/brand-icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { API_MODE } from "@/lib/api";
import { getErrorMessage, isApiError } from "@/lib/api/contract";
import { useConnectGithub } from "@/lib/queries";

const TOKEN_CREATION_URL = "https://github.com/settings/personal-access-tokens/new";

export interface ConnectGithubDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Asks for a fine-grained personal access token and connects the account. */
export function ConnectGithubDialog({ open, onOpenChange }: ConnectGithubDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* The form lives inside the content: closing the dialog resets it. */}
        <ConnectGithubForm onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function ConnectGithubForm({ onDone }: { onDone: () => void }) {
  const connect = useConnectGithub();
  const tokenId = useId();
  const errorId = useId();
  const [token, setToken] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The simulator ignores the token; a real backend validates it.
  const tokenOptional = API_MODE === "mock";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = token.trim();

    if (!tokenOptional && value === "") {
      setError("Collez votre jeton d’accès personnel pour continuer.");
      return;
    }
    setError(null);

    try {
      const result = await connect.mutateAsync(value ? { token: value } : undefined);
      toast.success("GitHub connecté", {
        description: result.account ? `Compte ${result.account.login}` : undefined,
      });
      onDone();
    } catch (failure) {
      if (isApiError(failure) && failure.field === "token") setError(failure.message);
      else toast.error(getErrorMessage(failure));
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="grid grid-cols-1 gap-4">
      <DialogHeader>
        <div className="mb-1 flex size-10 items-center justify-center rounded-xl bg-secondary ring-1 ring-border-strong">
          <GithubIcon aria-hidden className="size-5" />
        </div>
        <DialogTitle>Connecter GitHub</DialogTitle>
        <DialogDescription>
          Collez un jeton d’accès personnel à portée limitée. Il sert uniquement à lire vos
          dépôts et vos branches.
        </DialogDescription>
      </DialogHeader>

      <Field data-invalid={error ? true : undefined}>
        <FieldLabel htmlFor={tokenId}>
          Jeton d’accès personnel
          {tokenOptional ? (
            <span className="font-normal text-muted-foreground">(facultatif)</span>
          ) : null}
        </FieldLabel>
        <InputGroup>
          <InputGroupInput
            id={tokenId}
            type={revealed ? "text" : "password"}
            value={token}
            onChange={(event) => {
              setToken(event.target.value);
              if (error) setError(null);
            }}
            placeholder="github_pat_…"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className="font-mono text-[13px]"
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              size="icon-xs"
              aria-label={revealed ? "Masquer le jeton" : "Afficher le jeton"}
              aria-pressed={revealed}
              onClick={() => setRevealed((current) => !current)}
            >
              {revealed ? <EyeOff /> : <Eye />}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        <FieldError id={errorId}>{error}</FieldError>
      </Field>

      <div className="rounded-lg bg-secondary px-3 py-3 text-sm">
        <p className="font-medium">Permissions à accorder au jeton</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Sous « Repository permissions », activez uniquement :
        </p>
        <ul className="mt-2.5 space-y-1.5 text-xs">
          <li className="flex items-center gap-2">
            <Check aria-hidden className="size-3.5 shrink-0 text-success" />
            <span>
              <span className="font-mono text-[12px] text-foreground">Contents</span>
              <span className="text-muted-foreground"> : lecture seule</span>
            </span>
          </li>
          <li className="flex items-center gap-2">
            <Check aria-hidden className="size-3.5 shrink-0 text-success" />
            <span>
              <span className="font-mono text-[12px] text-foreground">Metadata</span>
              <span className="text-muted-foreground"> : lecture seule</span>
            </span>
          </li>
        </ul>
        <a
          href={TOKEN_CREATION_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-sm text-brand-400 underline-offset-4 hover:underline"
        >
          Créer un jeton sur GitHub
          <ExternalLink aria-hidden className="size-3.5" />
          <span className="sr-only">(s’ouvre dans un nouvel onglet)</span>
        </a>
      </div>

      {tokenOptional ? (
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          Mode démo : la connexion est simulée, aucun jeton n’est vérifié.
        </p>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={connect.isPending}>
          Annuler
        </Button>
        <Button type="submit" disabled={connect.isPending}>
          {connect.isPending ? (
            <Spinner data-icon="inline-start" aria-label="Connexion en cours" />
          ) : (
            <GithubIcon data-icon="inline-start" />
          )}
          Connecter
        </Button>
      </DialogFooter>
    </form>
  );
}
