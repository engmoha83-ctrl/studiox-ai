import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { open as openFile } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { AudioLines, Clock, Folder, FolderPlus, Image as ImageIcon, Link2, LoaderCircle, Plus, RefreshCw, Search, Star, Trash2, TriangleAlert, Upload } from "lucide-react";
import { fileUrl } from "../../backend/api";
import { uid } from "../../lib/id";
import { formatBytes, shortTime } from "../../lib/time";
import { useProject } from "../../store/projectStore";
import { useUi } from "../../store/uiStore";
import { addMediaToTimeline } from "../../editor/actions";
import { beginDrag } from "../../editor/dragdrop";
import { createProxy, MEDIA_EXTENSIONS, relinkMedia } from "../../services/media";
import type { MediaAsset, MediaKind } from "../../types/project";
import { Button, IconBtn, Select, confirmAction, cx, openContextMenu, promptText, Empty } from "../common/ui";

export default function MediaPanel({ importMedia, onlyKind }: { importMedia: () => void; onlyKind?: MediaKind }) {
  const { t } = useTranslation();
  const project = useProject((s) => s.project)!;
  const commit = useProject((s) => s.commit);
  const selectedMediaId = useUi((s) => s.selectedMediaId);
  const set = useUi((s) => s.set);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"all" | MediaKind>(onlyKind ?? "all");
  const [folder, setFolder] = useState<string>("all");
  const [sort, setSort] = useState<"added" | "recent" | "name">("added");
  const [favOnly, setFavOnly] = useState(false);

  const used = useMemo(() => new Set(Object.values(project.clips).flatMap((c) => (c.type === "media" ? [c.mediaId] : []))), [project.clips]);
  const effKind = onlyKind ?? kind;
  const list = project.media
    .filter((m) => (effKind === "all" ? true : m.kind === effKind))
    .filter((m) => (folder === "all" ? true : folder === "none" ? !m.folderId : m.folderId === folder))
    .filter((m) => !favOnly || m.favorite)
    .filter((m) => !q || m.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name) : sort === "recent" ? (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0) : a.addedAt - b.addedAt));

  const newFolder = async () => {
    const n = await promptText(t("New folder"), t("New folder"));
    if (n) {
      const id = uid("fld");
      commit(t("New folder"), (d) => void d.mediaFolders.push({ id, name: n }));
      setFolder(id);
    }
  };

  const remove = async (m: MediaAsset) => {
    const n = Object.values(project.clips).filter((c) => c.type === "media" && c.mediaId === m.id).length;
    if (n && !(await confirmAction(t("Remove media"), t("“{{name}}” is used by {{count}} clip(s). Remove it and its clips from the project? The file on disk is not deleted.", { name: m.name, count: n }), true))) return;
    commit(t("Remove media"), (d) => {
      d.media = d.media.filter((x) => x.id !== m.id);
      for (const c of Object.values(d.clips)) if (c.type === "media" && c.mediaId === m.id) delete d.clips[c.id];
    });
  };

  const menu = (e: React.MouseEvent, m: MediaAsset) =>
    openContextMenu(e, [
      { label: t("Add to timeline at playhead"), icon: <Plus size={14} />, onClick: () => addMediaToTimeline(m), disabled: m.missing },
      { label: m.favorite ? t("Remove from favorites") : t("Add to favorites"), icon: <Star size={14} />, onClick: () => commit(t("Favorite"), (d) => void (d.media.find((x) => x.id === m.id)!.favorite = !m.favorite)) },
      {
        label: t("Move to folder…"),
        icon: <Folder size={14} />,
        onClick: async () => {
          const names = project.mediaFolders.map((f) => f.name).join(", ");
          const n = await promptText(t("Folder name (empty = none)"), project.mediaFolders.find((f) => f.id === m.folderId)?.name ?? "", names ? `${t("Existing folders")}: ${names}` : undefined);
          if (n === null) return;
          commit(t("Move to folder"), (d) => {
            let f = d.mediaFolders.find((x) => x.name === n.trim());
            if (!f && n.trim()) {
              f = { id: uid("fld"), name: n.trim() };
              d.mediaFolders.push(f);
            }
            d.media.find((x) => x.id === m.id)!.folderId = f?.id ?? null;
          });
        },
      },
      { label: t("Generate proxy"), icon: <RefreshCw size={14} />, onClick: () => void createProxy(m.id), disabled: m.kind === "image" || m.proxyState === "pending" || m.missing },
      {
        label: t("Relink file…"),
        icon: <Link2 size={14} />,
        onClick: async () => {
          const f = await openFile({ multiple: false, filters: [{ name: t("Media files"), extensions: MEDIA_EXTENSIONS }] });
          if (typeof f === "string") await relinkMedia(m.id, f);
        },
      },
      { label: t("Show in folder"), icon: <Folder size={14} />, onClick: () => void revealItemInDir(m.path), disabled: m.missing },
      { separator: true },
      { label: t("Remove from project"), icon: <Trash2 size={14} />, danger: true, onClick: () => void remove(m) },
    ]);

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b border-line p-2.5">
        <div className="flex gap-1.5">
          <Button variant="primary" className="flex-1" onClick={importMedia}>
            <Upload size={14} />
            {t("Import")}
          </Button>
          <IconBtn tip={t("New folder")} onClick={newFolder}>
            <FolderPlus size={16} />
          </IconBtn>
          <IconBtn tip={t("Favorites only")} active={favOnly} onClick={() => setFavOnly(!favOnly)}>
            <Star size={16} />
          </IconBtn>
        </div>
        <div className="flex h-7 items-center gap-1.5 rounded-md border border-line-2 bg-panel-2 px-2">
          <Search size={13} className="text-dim" />
          <input type="search" dir="auto" className="w-full bg-transparent text-[12px] outline-none" placeholder={t("Search media")} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex gap-1.5">
          {!onlyKind && (
            <Select
              value={kind}
              onChange={setKind}
              options={[
                { value: "all", label: t("All types") },
                { value: "video", label: t("Video") },
                { value: "audio", label: t("Audio") },
                { value: "image", label: t("Images") },
              ]}
            />
          )}
          <Select
            value={folder}
            onChange={setFolder}
            options={[{ value: "all", label: t("All folders") }, { value: "none", label: t("No folder") }, ...project.mediaFolders.map((f) => ({ value: f.id, label: f.name }))]}
          />
          <Select
            value={sort}
            onChange={setSort}
            options={[
              { value: "added", label: t("Date added") },
              { value: "recent", label: t("Recently used") },
              { value: "name", label: t("Name") },
            ]}
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2.5">
        {list.length === 0 ? (
          <Empty icon={onlyKind === "audio" ? <AudioLines size={34} /> : <Upload size={34} />} text={project.media.length ? t("No media matches the filters.") : t("Import or drag video, audio and image files here.")}>
            <Button onClick={importMedia}>{t("Import media")}</Button>
          </Empty>
        ) : (
          <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(112px, 1fr))" }}>
            {list.map((m) => (
              <div
                key={m.id}
                data-media={m.name}
                onPointerDown={(e) => !m.missing && beginDrag(e, { kind: "media", id: m.id }, m.name)}
                onClick={() => set({ selectedMediaId: m.id, selection: [] })}
                onDoubleClick={() => addMediaToTimeline(m)}
                onContextMenu={(e) => menu(e, m)}
                className={cx("group cursor-pointer rounded-md p-1 ring-accent", selectedMediaId === m.id ? "bg-accent/15 ring-1" : "hover:bg-panel-3")}
                title={`${m.name}\n${m.width ? `${m.width}×${m.height} · ` : ""}${m.kind !== "image" ? shortTime(m.duration) + " · " : ""}${formatBytes(m.size)}`}
              >
                <div className="checker relative aspect-video overflow-hidden rounded">
                  {m.thumbnail ? (
                    <img src={fileUrl(m.thumbnail)} className="size-full object-cover" draggable={false} />
                  ) : (
                    <div className="flex size-full items-center justify-center text-dim">{m.kind === "audio" ? <AudioLines size={22} /> : m.kind === "image" ? <ImageIcon size={22} /> : <LoaderCircle size={18} className="animate-spin" />}</div>
                  )}
                  {m.kind !== "image" && (
                    <span className="absolute bottom-0.5 end-0.5 rounded bg-black/75 px-1 text-[10px] tabular-nums" dir="ltr">
                      {shortTime(m.duration)}
                    </span>
                  )}
                  {m.favorite && <Star size={12} className="absolute start-1 top-1 fill-amber-300 text-amber-300" />}
                  {m.missing && (
                    <span className="absolute inset-0 flex items-center justify-center bg-red-950/70 text-red-200">
                      <TriangleAlert size={18} />
                    </span>
                  )}
                  {m.proxyState === "pending" && <span className="absolute end-0.5 top-0.5 rounded bg-violet-600/90 px-1 text-[9px]">{t("Proxy…")}</span>}
                  {m.proxyState === "ready" && <span className="absolute end-0.5 top-0.5 rounded bg-black/70 px-1 text-[9px] text-teal-300">{t("Proxy")}</span>}
                  {!used.has(m.id) && <span className="absolute bottom-0.5 start-0.5 rounded bg-black/60 px-1 text-[9px] text-dim">{t("Unused")}</span>}
                </div>
                <div className="mt-1 truncate text-[11px]" dir="auto">
                  {m.name}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5 border-t border-line px-3 h-7 text-[11px] text-dim">
        <Clock size={11} />
        {t("{{count}} items", { count: list.length })}
        <span className="ms-auto">{t("Double-click or drag to the timeline")}</span>
      </div>
    </div>
  );
}

