'use client';
import { useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Upload } from 'lucide-react';
import { Button } from '@/ui/primitives/button';
const accepted = '.m4a,.mp3,.wav,.webm,.ogg,audio/*';
// S3: a recording made elsewhere, when the microphone is refused. The server reads its type from
// its bytes and caps it at 25 MB (CAPTURES-B12); the name and declared type are only labels.
export function CaptureUpload({
  pick,
  variant = 'default',
  ref,
}: {
  pick: (file: File) => void;
  variant?: 'default' | 'outline';
  ref?: React.Ref<HTMLButtonElement>;
}) {
  const t = useTranslations('captures');
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button ref={ref} variant={variant} onClick={() => input.current?.click()}>
        <Upload aria-hidden />
        {t('uploadAudio')}
      </Button>
      <input
        ref={input}
        type="file"
        accept={accepted}
        hidden
        data-testid="capture-file"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file) pick(file);
        }}
      />
    </>
  );
}
