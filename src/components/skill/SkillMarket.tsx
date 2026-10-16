"use client";

import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import {
  Check,
  Download,
  Filter,
  Layers3,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  ScrollText,
  Trash2,
  X,
} from "lucide-react";
import type { SkillBundle, SkillCatalogEntry, TextSkill } from "@/types";
import { useSettingsStore } from "@/store/core/settingsStore";
import { normalizeTextSkill } from "@/lib/skills";
import {
  fetchSkillCatalogResult,
  fetchSkillDefinition,
} from "@/services/api/skillService";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MARKET_LIMITS } from "@/config/limits";
import { logDevError } from "@/lib/utils/devLogger";
import type { MarketLoadResult } from "@/lib/market/loadResult";
import MarketLoadNotice from "@/components/ui/MarketLoadNotice";
import {
  PanelBadge,
  PanelCard,
  PanelCreateButton,
  PanelEmpty,
  PanelHeader,
  PanelIconButton,
  PanelLoading,
  PanelPagination,
  PanelRoot,
  PanelSearch,
  PanelSection,
} from "@/components/ui/panel";
import SkillParameterEditor from "./SkillParameterEditor";
import SkillBundleEditor from "./SkillBundleEditor";
import { Button } from "@/components/ui/primitives";

interface SkillMarketProps {
  onClose: () => void;
}

const ITEMS_PER_PAGE = 24;
const focusableModalSelector =
  'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

const trapModalFocus = (
  event: React.KeyboardEvent<HTMLElement>,
  container: HTMLElement | null,
) => {
  if (event.key !== "Tab" || !container) return;

  const focusableElements = Array.from(
    container.querySelectorAll<HTMLElement>(focusableModalSelector),
  ).filter((element) => element.offsetParent !== null);

  if (focusableElements.length === 0) {
    event.preventDefault();
    container.focus({ preventScroll: true });
    return;
  }

  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];

  if (event.shiftKey && document.activeElement === firstElement) {
    event.preventDefault();
    lastElement.focus({ preventScroll: true });
  } else if (!event.shiftKey && document.activeElement === lastElement) {
    event.preventDefault();
    firstElement.focus({ preventScroll: true });
  }
};

const titleCaseCategoryName = (value: string) =>
  value
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

type SkillCategoryTranslator = {
  (key: string): string;
  has(key: string): boolean;
};

export const formatCategoryName = (
  value: string,
  translate: SkillCategoryTranslator,
) => {
  const key = `categories.${value}`;
  return translate.has(key) ? translate(key) : titleCaseCategoryName(value);
};

const slugifySkillId = (value: string) => {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MARKET_LIMITS.maxSkillIdChars);
  return slug || `custom-skill-${Date.now()}`;
};

const createDefaultSkill = (locale: string): TextSkill => ({
  id: "",
  name: "",
  title: "",
  description: "",
  category: "custom",
  tags: [],
  audience: "user-facing",
  language: locale?.toLowerCase().startsWith("zh") ? "zh-CN" : "en",
  outputFormat: "markdown",
  risk: {
    level: "low",
    textOnly: true,
    scriptRequired: false,
    externalToolRequired: false,
    networkRequired: false,
    reviewRequiredForHighStakes: true,
  },
  activation: {
    embeddingText: "",
    useWhen: [],
    avoidWhen: [],
    exampleQueries: [],
  },
  content: "",
  isCustom: true,
});

const skillMatchesQuery = (
  skill: SkillCatalogEntry,
  query: string,
  selectedCategories: readonly string[],
) => {
  const matchesSearch =
    !query ||
    skill.title.toLowerCase().includes(query) ||
    skill.description.toLowerCase().includes(query) ||
    skill.tags.some((tag) => tag.toLowerCase().includes(query));
  const matchesCategory =
    selectedCategories.length === 0 ||
    selectedCategories.includes(skill.category);
  return matchesSearch && matchesCategory;
};

const SkillEditorModal = ({
  skill,
  onClose,
  onSave,
  onDelete,
  locale,
}: {
  skill?: TextSkill;
  onClose: () => void;
  onSave: (skill: TextSkill) => void;
  onDelete?: (skillId: string) => void;
  locale: string;
}) => {
  const t = useTranslations("Skill");
  const [draft, setDraft] = useState<TextSkill>(
    skill || createDefaultSkill(locale),
  );
  const [tagInput, setTagInput] = useState("");
  const [error, setError] = useState("");
  const [isDeleteConfirming, setIsDeleteConfirming] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const id = useId();
  const titleId = `${id}-title`;
  const tagInputId = `${id}-tag-input`;

  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus({ preventScroll: true });

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      if (previousFocusRef.current?.isConnected) {
        previousFocusRef.current.focus({ preventScroll: true });
      }
      previousFocusRef.current = null;
    };
  }, []);

  const updateDraft = (updates: Partial<TextSkill>) =>
    setDraft((current) => ({ ...current, ...updates }));

  const addTag = () => {
    const tag = tagInput.trim().slice(0, MARKET_LIMITS.maxSkillTagChars);
    if (
      tag &&
      draft.tags.length < MARKET_LIMITS.maxSkillTags &&
      !draft.tags.some((item) => item.toLowerCase() === tag.toLowerCase())
    ) {
      updateDraft({ tags: [...draft.tags, tag] });
      setTagInput("");
    }
  };

  const handleSave = () => {
    const id = skill?.id || slugifySkillId(draft.id || draft.title);
    const isBuiltInOverride = skill?.builtIn === true;
    const normalized = normalizeTextSkill({
      ...draft,
      id,
      name: slugifySkillId(draft.name || id),
      title: draft.title.trim() || titleCaseCategoryName(id),
      description: draft.description.trim(),
      content: draft.content.trim(),
      language: draft.language || createDefaultSkill(locale).language,
      activation: {
        ...draft.activation,
        embeddingText:
          draft.activation.embeddingText.trim() ||
          [draft.title, draft.description, ...draft.tags].join(" "),
      },
      builtIn: isBuiltInOverride,
      isCustom: true,
    });

    if (!normalized) {
      setError(t("invalidCustomSkill"));
      return;
    }
    if (
      (normalized.parameters || []).length !== (draft.parameters || []).length
    ) {
      setError(t("parameters.invalid"));
      return;
    }

    onSave({
      ...normalized,
      builtIn: isBuiltInOverride || undefined,
      isCustom: true,
    });
    onClose();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    trapModalFocus(event, dialogRef.current);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-9999 flex items-center justify-center bg-black/50 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur-sm animate-in fade-in duration-200"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col gap-4 overflow-hidden overscroll-contain rounded-2xl border border-border bg-card p-6 shadow-2xl sm:max-h-[90vh]"
      >
        <div className="flex items-center justify-between gap-3">
          <h2
            id={titleId}
            className="flex min-w-0 items-center gap-2 truncate text-lg font-bold text-foreground"
          >
            <ScrollText size={20} className="text-emerald-500" />
            {skill ? t("editSkill") : t("createSkill")}
          </h2>
          <Button
            variant="bare"
            ref={closeButtonRef}
            type="button"
            aria-label={t("closeEditor")}
            onClick={onClose}
            className="rounded-full p-1 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
          >
            <X size={20} aria-hidden="true" />
          </Button>
        </div>

        <div className="grid flex-1 gap-4 overflow-y-auto pr-1 custom-scrollbar md:grid-cols-2">
          {!skill && (
            <label className="space-y-1 text-sm font-medium text-foreground/85">
              <span>{t("skillId")}</span>
              <input
                type="text"
                name="skill-id"
                autoComplete="off"
                spellCheck={false}
                value={draft.id}
                onChange={(event) => updateDraft({ id: event.target.value })}
                placeholder="custom-writing-helper"
                className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-sm outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20"
              />
            </label>
          )}
          <label className="space-y-1 text-sm font-medium text-foreground/85">
            <span>{t("skillTitle")}</span>
            <input
              type="text"
              name="skill-title"
              autoComplete="off"
              value={draft.title}
              onChange={(event) => updateDraft({ title: event.target.value })}
              className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-sm outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20"
            />
          </label>
          <label className="space-y-1 text-sm font-medium text-foreground/85">
            <span>{t("category")}</span>
            <input
              type="text"
              name="skill-category"
              autoComplete="off"
              spellCheck={false}
              value={draft.category}
              onChange={(event) =>
                updateDraft({ category: event.target.value })
              }
              className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-sm outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20"
            />
          </label>
          <label className="space-y-1 text-sm font-medium text-foreground/85 md:col-span-2">
            <span>{t("skillDescription")}</span>
            <textarea
              name="skill-description"
              value={draft.description}
              onChange={(event) =>
                updateDraft({ description: event.target.value })
              }
              className="h-20 w-full resize-none rounded-xl border border-border bg-muted px-3 py-2 text-sm outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20"
            />
          </label>
          <label className="space-y-1 text-sm font-medium text-foreground/85 md:col-span-2">
            <span>{t("skillInstructions")}</span>
            <textarea
              name="skill-instructions"
              value={draft.content}
              onChange={(event) => updateDraft({ content: event.target.value })}
              className="h-28 w-full resize-none rounded-xl border border-border bg-muted px-3 py-2 text-sm outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20"
            />
          </label>
          <SkillParameterEditor
            parameters={draft.parameters || []}
            onChange={(parameters) => updateDraft({ parameters })}
          />
          <div className="space-y-2 md:col-span-2">
            <label
              htmlFor={tagInputId}
              className="text-sm font-medium text-foreground/85"
            >
              {t("tags")}
            </label>
            <div className="flex gap-2">
              <input
                id={tagInputId}
                type="text"
                name="skill-tag"
                autoComplete="off"
                value={tagInput}
                onChange={(event) => setTagInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addTag();
                  }
                }}
                placeholder={t("tagPlaceholder")}
                className="min-w-0 flex-1 rounded-xl border border-border bg-muted px-3 py-2 text-sm outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/20"
              />
              <Button
                variant="bare"
                type="button"
                aria-label={t("addTagAria")}
                onClick={addTag}
                className="rounded-xl bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-600 hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 dark:bg-emerald-900/20 dark:text-emerald-300"
              >
                <Plus size={16} aria-hidden="true" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {draft.tags.map((tag) => (
                <Button
                  variant="bare"
                  key={tag}
                  type="button"
                  aria-label={t("removeTagAria", { tag })}
                  onClick={() =>
                    updateDraft({
                      tags: draft.tags.filter((item) => item !== tag),
                    })
                  }
                  className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
                >
                  {tag}
                </Button>
              ))}
            </div>
          </div>
        </div>

        {error ? (
          <div
            role="alert"
            className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-300"
          >
            {error}
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-3 pt-2">
          {skill && onDelete ? (
            <Button
              variant="bare"
              type="button"
              onClick={() => {
                if (!isDeleteConfirming) {
                  setIsDeleteConfirming(true);
                  return;
                }
                onDelete(skill.id);
                onClose();
              }}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-red-600 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60 dark:text-red-300 dark:hover:bg-red-900/20"
            >
              <Trash2 size={14} aria-hidden="true" />
              {isDeleteConfirming ? t("confirmDelete") : t("delete")}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button
              variant="bare"
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
            >
              {t("cancel")}
            </Button>
            <Button
              variant="bare"
              type="button"
              onClick={handleSave}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
            >
              <Save size={14} aria-hidden="true" />
              {t("save")}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

const SkillCard = ({
  skill,
  mode,
  categoryLabel,
  isBusy = false,
  isUninstallConfirming = false,
  onInstall,
  onUninstall,
  onEdit,
}: {
  skill: SkillCatalogEntry | TextSkill;
  mode: "installed" | "available";
  categoryLabel: string;
  isBusy?: boolean;
  isUninstallConfirming?: boolean;
  onInstall?: () => void;
  onUninstall?: () => void;
  onEdit?: () => void;
}) => {
  const t = useTranslations("Skill");
  const isInstalled = mode === "installed";

  return (
    <PanelCard className="p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <PanelBadge className="w-fit max-w-full truncate border border-panel-accent/20">
            {categoryLabel}
          </PanelBadge>
          <div className="flex flex-wrap gap-1">
            {skill.isCustom ? (
              <PanelBadge tone="neutral" className="w-fit">
                {t("custom")}
              </PanelBadge>
            ) : null}
            {isInstalled ? (
              <PanelBadge className="w-fit">{t("installed")}</PanelBadge>
            ) : null}
          </div>
        </div>
        {isInstalled ? (
          <Check size={16} className="shrink-0 text-panel-accent-text" />
        ) : null}
      </div>
      <h3 className="mb-1 truncate text-sm font-semibold text-foreground">
        {skill.title}
      </h3>
      <p className="mb-3 line-clamp-3 flex-1 text-xs leading-relaxed text-muted-foreground">
        {skill.description}
      </p>
      <div className="mt-auto flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap gap-1">
          {skill.tags.slice(0, 3).map((tag) => (
            <PanelBadge
              key={tag}
              tone="neutral"
              className="max-w-20 truncate rounded"
            >
              {tag}
            </PanelBadge>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {isInstalled ? (
            <>
              <Button
                variant="bare"
                type="button"
                onClick={onEdit}
                className="rounded-lg px-2 py-1 text-xs font-medium text-panel-accent-text hover:bg-panel-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-panel-accent/60"
              >
                {t("edit")}
              </Button>
              <Button
                variant="bare"
                type="button"
                aria-label={t("uninstallSkillAria", { title: skill.title })}
                onClick={onUninstall}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/60 dark:text-red-300 dark:hover:bg-red-900/20"
              >
                <Trash2 size={13} aria-hidden="true" />
                {isUninstallConfirming ? t("confirmUninstall") : t("uninstall")}
              </Button>
            </>
          ) : (
            <Button
              variant="bare"
              type="button"
              aria-label={t("installSkillAria", { title: skill.title })}
              aria-busy={isBusy || undefined}
              onClick={onInstall}
              disabled={isBusy}
              className="inline-flex items-center gap-1 rounded-lg bg-panel-accent px-2.5 py-1.5 text-xs font-medium text-white hover:bg-panel-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-panel-accent/60 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isBusy ? (
                <Loader2
                  size={13}
                  className="animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <Download size={13} aria-hidden="true" />
              )}
              {t("install")}
            </Button>
          )}
        </div>
      </div>
    </PanelCard>
  );
};

const SkillMarket: React.FC<SkillMarketProps> = ({ onClose }) => {
  const t = useTranslations("Skill");
  const locale = useLocale();
  const {
    installedSkills,
    installSkill,
    uninstallSkill,
    updateInstalledSkill,
    addCustomSkill,
    removeCustomSkill,
    skillBundles,
    activeSkillBundleIds,
    addSkillBundle,
    updateSkillBundle,
    removeSkillBundle,
    toggleSkillBundleActive,
  } = useSettingsStore();

  const [builtInSkills, setBuiltInSkills] = useState<SkillCatalogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [marketLoadResult, setMarketLoadResult] = useState<
    MarketLoadResult<unknown> | undefined
  >();
  const [installingSkillIds, setInstallingSkillIds] = useState<string[]>([]);
  const [installError, setInstallError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [showCategoryFilter, setShowCategoryFilter] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [editingSkill, setEditingSkill] = useState<TextSkill | undefined>();
  const [showEditor, setShowEditor] = useState(false);
  const [editingBundle, setEditingBundle] = useState<SkillBundle | undefined>();
  const [showBundleEditor, setShowBundleEditor] = useState(false);
  const [uninstallConfirmingSkillId, setUninstallConfirmingSkillId] = useState<
    string | null
  >(null);
  const isMountedRef = useRef(true);
  const requestRef = useRef(0);
  const searchInputId = useId();

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      requestRef.current += 1;
    };
  }, []);

  const loadSkills = useCallback(
    async (forceRefresh = false) => {
      const requestId = requestRef.current + 1;
      requestRef.current = requestId;
      if (forceRefresh) setIsRefreshing(true);
      else {
        setIsLoading(true);
        setMarketLoadResult(undefined);
      }
      try {
        const result = await fetchSkillCatalogResult(locale, forceRefresh);
        if (isMountedRef.current && requestRef.current === requestId) {
          if (result.status !== "error") {
            setBuiltInSkills(result.data.skills);
          }
          setMarketLoadResult(result);
        }
      } catch (error) {
        logDevError("Failed to load skills:", error);
      } finally {
        if (isMountedRef.current && requestRef.current === requestId) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [locale],
  );

  useEffect(() => {
    void loadSkills(false);
  }, [loadSkills]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedCategories]);

  const query = searchTerm.trim().toLowerCase();
  const installedIdSet = useMemo(
    () => new Set(installedSkills.map((skill) => skill.id)),
    [installedSkills],
  );
  useEffect(() => {
    if (
      uninstallConfirmingSkillId &&
      !installedIdSet.has(uninstallConfirmingSkillId)
    ) {
      setUninstallConfirmingSkillId(null);
    }
  }, [installedIdSet, uninstallConfirmingSkillId]);

  const installingIdSet = useMemo(
    () => new Set(installingSkillIds),
    [installingSkillIds],
  );
  const categories = useMemo(
    () =>
      Array.from(
        new Set([
          ...builtInSkills.map((skill) => skill.category),
          ...installedSkills.map((skill) => skill.category),
        ]),
      ).sort(),
    [builtInSkills, installedSkills],
  );
  const filteredInstalledSkills = useMemo(
    () =>
      [...installedSkills]
        .filter((skill) => skillMatchesQuery(skill, query, selectedCategories))
        .sort((a, b) =>
          a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
        ),
    [installedSkills, query, selectedCategories],
  );
  const filteredBuiltInSkills = useMemo(
    () =>
      builtInSkills
        .filter((skill) => !installedIdSet.has(skill.id))
        .filter((skill) => skillMatchesQuery(skill, query, selectedCategories)),
    [builtInSkills, installedIdSet, query, selectedCategories],
  );
  const totalPages = Math.max(
    1,
    Math.ceil(filteredBuiltInSkills.length / ITEMS_PER_PAGE),
  );
  const paginatedSkills = filteredBuiltInSkills.slice(
    (currentPage - 1) * ITEMS_PER_PAGE,
    currentPage * ITEMS_PER_PAGE,
  );

  const handleSaveSkill = (skill: TextSkill) => {
    if (installedIdSet.has(skill.id)) {
      updateInstalledSkill(skill.id, skill);
    } else {
      addCustomSkill(skill);
    }
  };

  const handleSaveBundle = (bundle: SkillBundle) => {
    if (skillBundles.some((item) => item.id === bundle.id)) {
      updateSkillBundle(bundle.id, bundle);
    } else {
      addSkillBundle(bundle);
    }
  };

  const handleInstallSkill = async (skill: SkillCatalogEntry) => {
    setInstallError("");
    setUninstallConfirmingSkillId(null);
    setInstallingSkillIds((current) =>
      current.includes(skill.id) ? current : [...current, skill.id],
    );
    try {
      const definition = await fetchSkillDefinition(skill, locale);
      if (!isMountedRef.current) return;
      if (!definition) {
        setInstallError(t("installFailed"));
        return;
      }
      installSkill({
        ...definition,
        builtIn: true,
        isCustom: undefined,
      });
    } catch (error) {
      logDevError("Failed to install skill:", error);
      if (isMountedRef.current) setInstallError(t("installFailed"));
    } finally {
      if (isMountedRef.current) {
        setInstallingSkillIds((current) =>
          current.filter((id) => id !== skill.id),
        );
      }
    }
  };

  const confirmUninstallSkill = (skillId: string) => {
    setInstallError("");
    if (uninstallConfirmingSkillId === skillId) {
      uninstallSkill(skillId);
      setUninstallConfirmingSkillId(null);
      return;
    }
    setUninstallConfirmingSkillId(skillId);
  };

  const toggleCategory = (category: string) => {
    setSelectedCategories((current) =>
      current.includes(category)
        ? current.filter((item) => item !== category)
        : [...current, category],
    );
  };

  const renderCategoryFilter = () => (
    <div className="relative shrink-0">
      <DropdownMenu
        open={showCategoryFilter}
        onOpenChange={setShowCategoryFilter}
      >
        <DropdownMenuTrigger asChild>
          <Button
            variant="bare"
            type="button"
            aria-label={
              selectedCategories.length > 0
                ? t("filterCategorySelectedAria", {
                    count: selectedCategories.length,
                  })
                : t("filterCategoryAria")
            }
            className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-panel-accent/60 ${
              selectedCategories.length > 0
                ? "bg-panel-accent-soft text-panel-accent-text"
                : "bg-transparent text-muted-foreground hover:bg-muted"
            }`}
          >
            <Filter size={12} aria-hidden="true" />
            <span>
              {selectedCategories.length > 0
                ? t("selectedCount", {
                    count: selectedCategories.length,
                  })
                : t("filter")}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="bottom"
          align="end"
          className="max-h-80 w-64 overflow-y-auto custom-scrollbar"
        >
          {selectedCategories.length > 0 && (
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setSelectedCategories([])}
            >
              {t("clearSelection")}
            </DropdownMenuItem>
          )}
          {categories.map((category) => (
            <DropdownMenuCheckboxItem
              key={category}
              checked={selectedCategories.includes(category)}
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={() => toggleCategory(category)}
            >
              <span className="truncate">
                {formatCategoryName(category, t)}
              </span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  const marketNoticeMessage = (() => {
    if (marketLoadResult?.status === "stale") {
      const time = marketLoadResult.fetchedAt
        ? new Date(marketLoadResult.fetchedAt).toLocaleString(locale)
        : t("unknownCacheTime");
      const staleMessage = t("staleData", { time });
      return marketLoadResult.fallbackFrom
        ? `${t("englishFallback")} ${staleMessage}`
        : staleMessage;
    }
    if (marketLoadResult?.status === "fallback") {
      return t("englishFallback");
    }
    if (marketLoadResult?.status === "error") return t("loadFailed");
    return "";
  })();

  return (
    <PanelRoot accent="skills">
      {showEditor && (
        <SkillEditorModal
          skill={editingSkill}
          onClose={() => setShowEditor(false)}
          onSave={handleSaveSkill}
          onDelete={
            editingSkill?.isCustom && !editingSkill.builtIn
              ? removeCustomSkill
              : undefined
          }
          locale={locale}
        />
      )}
      {showBundleEditor ? (
        <SkillBundleEditor
          bundle={editingBundle}
          skills={installedSkills}
          onClose={() => setShowBundleEditor(false)}
          onSave={handleSaveBundle}
          onDelete={editingBundle ? removeSkillBundle : undefined}
        />
      ) : null}

      <PanelHeader
        icon={<ScrollText size={20} />}
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <PanelIconButton
            type="button"
            aria-label={t("refreshAria")}
            aria-busy={isRefreshing || undefined}
            onClick={() => void loadSkills(true)}
            disabled={isRefreshing}
          >
            {isRefreshing ? (
              <Loader2 size={18} className="animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw size={18} aria-hidden="true" />
            )}
          </PanelIconButton>
        }
        onClose={onClose}
        closeLabel={t("closeMarket")}
      />

      {marketNoticeMessage ? (
        <div className="mx-4 mt-4 sm:mx-6">
          <MarketLoadNotice
            status={marketLoadResult?.status}
            message={marketNoticeMessage}
            retryLabel={t("retry")}
            onRetry={() => void loadSkills(true)}
            isRetrying={isRefreshing}
          />
        </div>
      ) : null}

      {/* Search Bar */}
      <PanelSearch
        id={searchInputId}
        name="skill-search"
        type="search"
        label={t("searchLabel")}
        placeholder={t("searchPlaceholder")}
        value={searchTerm}
        onChange={(event) => setSearchTerm(event.target.value)}
      />

      <div className="flex-1 overflow-y-auto px-4 pb-10 custom-scrollbar">
        <div className="mx-auto flex min-h-full max-w-7xl flex-col gap-8">
          {installError ? (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300"
            >
              {installError}
            </div>
          ) : null}

          <PanelSection
            title={t("bundles.heading")}
            icon={<Layers3 size={16} />}
            actions={
              <PanelCreateButton
                type="button"
                onClick={() => {
                  setEditingBundle(undefined);
                  setShowBundleEditor(true);
                }}
                disabled={installedSkills.length === 0}
              >
                {t("bundles.new")}
              </PanelCreateButton>
            }
          >
            <p className="-mt-2 mb-4 px-1 text-xs text-muted-foreground">
              {t("bundles.headingDescription")}
            </p>
            {skillBundles.length > 0 ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {skillBundles.map((bundle) => {
                  const missingSkills = bundle.steps.filter(
                    (step) => !installedIdSet.has(step.skillId),
                  );
                  const isActive = activeSkillBundleIds.includes(bundle.id);
                  return (
                    <PanelCard
                      key={bundle.id}
                      className="bg-panel-accent-2/5 border-panel-accent-2/20 p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="truncate text-sm font-semibold text-foreground">
                            {bundle.title}
                          </h3>
                          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                            {bundle.description ||
                              t("bundles.stepCount", {
                                count: bundle.steps.length,
                              })}
                          </p>
                        </div>
                        <Button
                          variant="bare"
                          type="button"
                          role="switch"
                          aria-checked={isActive}
                          disabled={missingSkills.length > 0}
                          onClick={() => toggleSkillBundleActive(bundle.id)}
                          className={`rounded-full px-2 py-1 text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-panel-accent/60 disabled:opacity-50 ${isActive ? "bg-panel-accent text-white" : "bg-muted text-muted-foreground"}`}
                        >
                          {isActive
                            ? t("bundles.active")
                            : t("bundles.inactive")}
                        </Button>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1">
                        {bundle.steps.map((step, index) => (
                          <PanelBadge
                            key={step.id}
                            tone={
                              installedIdSet.has(step.skillId)
                                ? "neutral"
                                : "accent"
                            }
                            className={
                              installedIdSet.has(step.skillId)
                                ? "rounded bg-card text-foreground/75"
                                : "rounded bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-300"
                            }
                          >
                            {index + 1}. {step.skillId}
                          </PanelBadge>
                        ))}
                      </div>
                      {missingSkills.length > 0 ? (
                        <p className="mt-2 text-[11px] text-red-600 dark:text-red-300">
                          {t("bundles.invalidMissing")}
                        </p>
                      ) : null}
                      <Button
                        variant="bare"
                        type="button"
                        onClick={() => {
                          setEditingBundle(bundle);
                          setShowBundleEditor(true);
                        }}
                        className="mt-4 self-end rounded-lg px-2 py-1 text-xs font-medium text-panel-accent-text hover:bg-panel-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-panel-accent/60"
                      >
                        {t("edit")}
                      </Button>
                    </PanelCard>
                  );
                })}
              </div>
            ) : (
              <PanelEmpty className="rounded-xl px-4 py-8 text-xs">
                {t("bundles.none")}
              </PanelEmpty>
            )}
          </PanelSection>

          <PanelSection
            title={t("installedSkills")}
            icon={<ScrollText size={16} />}
            actions={
              <PanelCreateButton
                type="button"
                aria-label={t("createCustomAria")}
                onClick={() => {
                  setEditingSkill(undefined);
                  setShowEditor(true);
                }}
              >
                {t("custom")}
              </PanelCreateButton>
            }
          >
            {filteredInstalledSkills.length > 0 ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filteredInstalledSkills.map((skill) => (
                  <SkillCard
                    key={skill.id}
                    skill={skill}
                    mode="installed"
                    categoryLabel={formatCategoryName(skill.category, t)}
                    isUninstallConfirming={
                      uninstallConfirmingSkillId === skill.id
                    }
                    onUninstall={() => confirmUninstallSkill(skill.id)}
                    onEdit={() => {
                      setUninstallConfirmingSkillId(null);
                      setEditingSkill(skill);
                      setShowEditor(true);
                    }}
                  />
                ))}
              </div>
            ) : (
              <PanelEmpty className="border-0 py-10">
                {t("noInstalledSkills")}
              </PanelEmpty>
            )}
          </PanelSection>

          {/* Available Section */}
          <PanelSection
            className="flex flex-1 flex-col"
            title={searchTerm ? t("searchResults") : t("allSkills")}
            muted
            actions={renderCategoryFilter()}
          >
            {isLoading ? (
              <PanelLoading label={t("loading")} />
            ) : (
              <>
                <div className="grid flex-1 grid-cols-1 content-start gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {paginatedSkills.map((skill) => (
                    <SkillCard
                      key={skill.id}
                      skill={skill}
                      mode="available"
                      categoryLabel={formatCategoryName(skill.category, t)}
                      isBusy={installingIdSet.has(skill.id)}
                      onInstall={() => void handleInstallSkill(skill)}
                    />
                  ))}
                </div>
                {paginatedSkills.length === 0 &&
                  marketLoadResult &&
                  ["fresh", "cache", "fallback"].includes(
                    marketLoadResult.status,
                  ) && (
                    <PanelEmpty className="border-0 py-12">
                      {t("noSkillsFound")}
                    </PanelEmpty>
                  )}
                {totalPages > 1 && (
                  <PanelPagination
                    page={currentPage}
                    totalPages={totalPages}
                    onPrev={() =>
                      setCurrentPage((page) => Math.max(1, page - 1))
                    }
                    onNext={() =>
                      setCurrentPage((page) => Math.min(totalPages, page + 1))
                    }
                    prevLabel={t("prevPageAria")}
                    nextLabel={t("nextPageAria")}
                    label={t("pageOf", { currentPage, totalPages })}
                  />
                )}
              </>
            )}
          </PanelSection>
        </div>
      </div>
    </PanelRoot>
  );
};

export default SkillMarket;
