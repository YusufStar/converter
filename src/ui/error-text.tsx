import { handOff } from "../lib/handoff";
import { useT } from "../lib/i18n";
import { ENCRYPTED } from "../lib/pdf/errors";
import { Link } from "./link";
import { ui } from "./strings";

/** An error message; a password-protected PDF gets a link that carries the files to Unlock PDF. */
export function ErrorText({ message, files }: { message: string; files?: File[] }) {
  const t = useT(ui);
  if (message !== ENCRYPTED) return <>{message}</>;
  return (
    <>
      {t("pdfLocked")}{" "}
      <Link
        to="/unlock-pdf"
        onClick={() => files?.length && handOff("unlock-pdf", files)}
        className="font-medium whitespace-nowrap underline underline-offset-2"
      >
        {t("unlockFirst")}
      </Link>
    </>
  );
}
