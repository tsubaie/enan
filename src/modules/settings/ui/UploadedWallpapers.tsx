'use client';
import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ImagePlus, Trash2 } from 'lucide-react';
import { Button } from '@/ui/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/ui/primitives/dialog';
import { ErrorPanel } from '@/ui/layout/ErrorPanel';
import { ApiError } from '@/core/http/client';
import { WallpaperMime, wallpaperImageLimits } from '@/core/config/wallpapers';
import type { UploadedWallpaper } from '../schema/validation';
import { useDeleteWallpaper, useUploadWallpaper, useWallpapers } from './queries';
import { WallpaperSwatch } from './WallpaperSwatch';
// ADMIN-B47: the administrator's own wallpapers, each a swatch of its image with a delete button,
// and a tile that uploads another. Deleting is for good, so it asks first, and says when the image
// is the one in use that the default takes its place.
export function UploadedWallpapers({
  current,
  busy,
  choose,
}: {
  current: string;
  busy: boolean;
  choose: (wallpaper: UploadedWallpaper) => void;
}) {
  const t = useTranslations('admin');
  const query = useWallpapers();
  const remove = useDeleteWallpaper();
  const [deleting, setDeleting] = useState<UploadedWallpaper | null>(null);
  const wallpapers = query.data?.data ?? [];
  return (
    <div className="mt-4 grid gap-2">
      <h4 className="text-sm font-medium">{t('wallpaperYours')}</h4>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {wallpapers.length > 0 && (
          <div role="radiogroup" aria-label={t('wallpaperYours')} className="contents">
            {wallpapers.map((wallpaper) => (
              <div key={wallpaper.id} className="relative min-w-0">
                <WallpaperSwatch
                  label={wallpaper.name}
                  swatch="custom"
                  image={wallpaper.thumbnail}
                  chosen={current === wallpaper.id}
                  busy={busy || remove.isPending}
                  choose={() => choose(wallpaper)}
                />
                <Button
                  size="icon-sm"
                  variant="secondary"
                  className="absolute end-1.5 top-1.5"
                  aria-label={t('wallpaperDelete', { name: wallpaper.name })}
                  disabled={remove.isPending}
                  onClick={() => setDeleting(wallpaper)}
                >
                  <Trash2 aria-hidden />
                </Button>
              </div>
            ))}
          </div>
        )}
        {!query.error && <UploadTile />}
      </div>
      {query.error && <ListError error={query.error} retry={() => void query.refetch()} />}
      {remove.error && <ErrorPanel error={remove.error} />}
      <DeleteDialog
        wallpaper={deleting}
        chosen={deleting?.id === current}
        close={() => setDeleting(null)}
        confirm={(id) => remove.mutate(id)}
      />
    </div>
  );
}
// The images could not be read (a database not yet updated, an outage): said in words, with the
// built-in wallpapers above still usable and the request id to report.
function ListError({ error, retry }: { error: Error; retry: () => void }) {
  const t = useTranslations('admin');
  return (
    <div className="grid gap-2">
      <p className="text-sm text-danger">{t('wallpaperYoursError')}</p>
      <ErrorPanel error={error} retry={retry} />
    </div>
  );
}
// Deleting is for good, so it is confirmed, and the confirmation says when the image is the one in
// use that the default takes its place.
function DeleteDialog({
  wallpaper,
  chosen,
  close,
  confirm,
}: {
  wallpaper: UploadedWallpaper | null;
  chosen: boolean;
  close: () => void;
  confirm: (id: string) => void;
}) {
  const t = useTranslations('admin');
  return (
    <Dialog open={wallpaper !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent>
        <DialogTitle>{t('wallpaperDeleteTitle')}</DialogTitle>
        <DialogDescription>
          {chosen ? t('wallpaperDeleteChosen') : t('wallpaperDeleteConfirm')}
        </DialogDescription>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            {t('wallpaperKeep')}
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (wallpaper) confirm(wallpaper.id);
              close();
            }}
          >
            {t('wallpaperDeleteAction')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
// The tile that uploads an image: the file is measured in the browser for its tone and accent, then
// sent. What the server refuses (type, size) is said in words.
function UploadTile() {
  const t = useTranslations('admin');
  const upload = useUploadWallpaper();
  const input = useRef<HTMLInputElement>(null);
  const send = (file: File) => {
    const form = new FormData();
    form.set('file', file);
    upload.mutate(form);
  };
  const refusal = upload.error instanceof ApiError ? refusalOf(upload.error) : null;
  return (
    <div className="grid min-w-0 gap-1.5">
      <button
        type="button"
        disabled={upload.isPending}
        onClick={() => input.current?.click()}
        className="flex aspect-video flex-col items-center justify-center gap-1 rounded-xl border border-dashed text-text-muted transition-colors outline-none hover:border-text-faint hover:text-text focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset disabled:opacity-50"
      >
        <ImagePlus className="size-5" aria-hidden />
        <span className="text-xs">
          {upload.isPending ? t('wallpaperUploading') : t('wallpaperUpload')}
        </span>
      </button>
      <span className="px-0.5 text-xs font-light text-text-faint">
        {t('wallpaperUploadHint', { size: wallpaperImageLimits.minLongEdge })}
      </span>
      <input
        ref={input}
        type="file"
        hidden
        accept={WallpaperMime.options.join(',')}
        aria-label={t('wallpaperUpload')}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) send(file);
        }}
      />
      {refusal && (
        <p role="alert" className="text-xs text-danger">
          {refusal === 'too_large' && t('wallpaperTooLarge')}
          {refusal === 'wrong_type' && t('wallpaperWrongType')}
          {refusal === 'too_small' &&
            t('wallpaperTooSmall', { size: wallpaperImageLimits.minLongEdge })}
          {refusal === 'limit_reached' &&
            t('wallpaperLimit', { max: wallpaperImageLimits.maxStored })}
        </p>
      )}
      {upload.error && !refusal && <ErrorPanel error={upload.error} />}
    </div>
  );
}
// What the server refused, as one of the sentences the tile can say.
function refusalOf(error: ApiError) {
  const details = error.details;
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null;
  switch (details.reason) {
    case 'too_large':
    case 'too_many_pixels':
      return 'too_large';
    case 'unsupported_type':
    case 'unreadable':
    case 'animated':
      return 'wrong_type';
    case 'too_small':
      return 'too_small';
    case 'limit_reached':
      return 'limit_reached';
    default:
      return null;
  }
}
