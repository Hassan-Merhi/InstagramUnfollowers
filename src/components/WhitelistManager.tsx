import React, { useRef, useState } from "react";
import { UserNode } from "../model/user";
import { exportWhitelist, importWhitelist, clearWhitelist, mergeWhitelists } from "../utils/whitelist-manager";
import { Language, t } from "../utils/i18n";

interface WhitelistManagerProps {
  whitelistedUsers: readonly UserNode[];
  onWhitelistUpdate: (users: readonly UserNode[]) => void;
  lang: Language;
}

export const WhitelistManager = ({ whitelistedUsers, onWhitelistUpdate, lang }: WhitelistManagerProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importMode, setImportMode] = useState<"replace" | "merge">("merge");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [showPasteArea, setShowPasteArea] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteMode, setPasteMode] = useState<"add" | "remove">("add");

  const handleExport = () => {
    exportWhitelist(whitelistedUsers);
    setMessage({ type: "success", text: `Exported ${whitelistedUsers.length} users successfully` });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;

    importWhitelist(
      file,
      (importedUsers) => {
        let finalUsers: readonly UserNode[];
        
        if (importMode === "merge") {
          finalUsers = mergeWhitelists(whitelistedUsers, importedUsers);
          const newUsersCount = finalUsers.length - whitelistedUsers.length;
          setMessage({ 
            type: "success", 
            text: `Merged successfully! Added ${newUsersCount} new users (${importedUsers.length} imported, ${importedUsers.length - newUsersCount} duplicates skipped)` 
          });
        } else {
          finalUsers = mergeWhitelists([], importedUsers);
          setMessage({
            type: "success",
            text: `Replaced whitelist with ${finalUsers.length} unique users`,
          });
        }
        
        onWhitelistUpdate(finalUsers);
        setTimeout(() => setMessage(null), 5000);
      },
      (errorMessage) => {
        setMessage({ type: "error", text: errorMessage });
        setTimeout(() => setMessage(null), 5000);
      }
    );

    // Reset file input
    event.currentTarget.value = "";
  };

  const handleClear = () => {
    if (!confirm(t(lang, "clearWhitelistConfirm"))) {
      return;
    }
    clearWhitelist();
    onWhitelistUpdate([]);
    setMessage({ type: "success", text: t(lang, "whitelistCleared") });
    setTimeout(() => setMessage(null), 3000);
  };

  const handlePasteSubmit = () => {
    const rawTokens = pasteText
      .split(/[\s,;\n\r\t]+/)
      .map(value => value.replace(/^@+/, "").trim().toLowerCase())
      .filter(value => value.length > 0 && /^[a-zA-Z0-9._]+$/.test(value));

    if (rawTokens.length === 0) {
      setMessage({ type: "error", text: t(lang, "noValidUsernamesFound") });
      setTimeout(() => setMessage(null), 4000);
      return;
    }

    const uniqueUsernames = Array.from(new Set(rawTokens));
    const targetUsernames = new Set(uniqueUsernames);

    if (pasteMode === "remove") {
      const updated = whitelistedUsers.filter(
        user => !targetUsernames.has(user.username.trim().toLowerCase()),
      );
      const removedCount = whitelistedUsers.length - updated.length;
      if (removedCount === 0) {
        setMessage({ type: "error", text: t(lang, "noPastedUsersMatched") });
        setTimeout(() => setMessage(null), 4000);
        return;
      }
      onWhitelistUpdate(updated);
      setPasteText("");
      setMessage({
        type: "success",
        text: t(lang, "pastedUsersRemoved", removedCount),
      });
      setTimeout(() => setMessage(null), 5000);
      return;
    }

    const existingUsernames = new Set(
      whitelistedUsers.map(user => user.username.trim().toLowerCase()),
    );
    const toAdd = uniqueUsernames.filter(username => !existingUsernames.has(username));

    if (toAdd.length === 0) {
      setMessage({ type: "success", text: t(lang, "pastedUsersAlreadyExist") });
      setTimeout(() => setMessage(null), 4000);
      return;
    }

    const createdAt = Date.now();
    const newNodes: UserNode[] = toAdd.map((username, index) => ({
      id: `pasted_${username}_${createdAt}_${index}`,
      username,
      full_name: username,
      profile_pic_url: `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(username)}&backgroundColor=0f172a,1f2937,312e81&fontFamily=Verdana`,
      is_private: false,
      is_verified: false,
      followed_by_viewer: true,
      follows_viewer: false,
      requested_by_viewer: false,
    }));

    onWhitelistUpdate([...whitelistedUsers, ...newNodes]);
    setPasteText("");
    setMessage({
      type: "success",
      text: t(lang, "pastedUsersAdded", newNodes.length),
    });
    setTimeout(() => setMessage(null), 5000);
  };

  return (
    <div className="whitelist-manager">
      <div className="whitelist-header">
        <h4>{t(lang, "whitelistTitle")}</h4>
        <span className="whitelist-count">
          {whitelistedUsers.length} {whitelistedUsers.length === 1 ? t(lang, "userSingular") : t(lang, "userPlural")}
        </span>
      </div>

      {message && (
        <div className={`whitelist-message ${message.type === "error" ? "error" : "success"}`}>
          {message.text}
        </div>
      )}

      <div className="whitelist-actions">
        <button 
          className="btn btn-export" 
          onClick={handleExport}
          disabled={whitelistedUsers.length === 0}
          title={whitelistedUsers.length === 0 ? "No users" : t(lang, "exportWhitelist")}
        >
          📥 {t(lang, "exportWhitelist")}
        </button>

        <div className="import-section">
          <div className="import-mode">
            <label>
              <input
                type="radio"
                name="importMode"
                value="merge"
                checked={importMode === "merge"}
                onChange={() => setImportMode("merge")}
              />
              {t(lang, "mergeWhitelist")}
            </label>
            <label>
              <input
                type="radio"
                name="importMode"
                value="replace"
                checked={importMode === "replace"}
                onChange={() => setImportMode("replace")}
              />
              {t(lang, "replaceWhitelist")}
            </label>
          </div>

          <button 
            className="btn btn-import" 
            onClick={handleImportClick}
            title={t(lang, "importWhitelist")}
          >
            📤 {t(lang, "importWhitelist")}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleFileChange}
            style={{ display: "none" }}
          />
        </div>

        <button 
          type="button"
          className="btn btn-paste" 
          onClick={() => setShowPasteArea(!showPasteArea)}
          title={t(lang, "pasteWhitelist")}
        >
          📋 {t(lang, "pasteWhitelist")}
        </button>

        <button 
          className="btn btn-clear" 
          onClick={handleClear}
          disabled={whitelistedUsers.length === 0}
          title={t(lang, "clearWhitelist")}
        >
          🗑️ {t(lang, "clearWhitelist")}
        </button>
      </div>

      {showPasteArea && (
        <div className="paste-whitelist-box">
          <div className="paste-mode-toggle" role="group" aria-label={t(lang, "pasteWhitelist")}>
            <button
              type="button"
              className={`btn ${pasteMode === "add" ? "active" : ""}`}
              onClick={() => setPasteMode("add")}
            >
              ➕ {t(lang, "addPastedToWhitelist")}
            </button>
            <button
              type="button"
              className={`btn ${pasteMode === "remove" ? "active" : ""}`}
              onClick={() => setPasteMode("remove")}
            >
              ➖ {t(lang, "removePastedFromWhitelist")}
            </button>
          </div>
          <textarea
            className="paste-whitelist-textarea"
            placeholder={t(lang, "pasteWhitelistPlaceholder")}
            value={pasteText}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setPasteText(e.currentTarget.value)}
            rows={3}
          />
          <button
            type="button"
            className="btn btn-paste-submit"
            onClick={handlePasteSubmit}
          >
            {pasteMode === "add" ? "➕" : "➖"}{" "}
            {pasteMode === "add"
              ? t(lang, "addPastedToWhitelist")
              : t(lang, "removePastedFromWhitelist")}
          </button>
        </div>
      )}

      <div className="whitelist-info">
        <p className="info-text">
          <strong>💡 Tip:</strong> {t(lang, "whitelistTip")}
        </p>
      </div>
    </div>
  );
};
