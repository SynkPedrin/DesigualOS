import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import type { Language, MeResponse, Theme, UpdateAvatarResponseWire, UpdateMeRequestWire, UpdateMeResponseWire } from '@/lib/api/contracts';

export function useUpdateMe() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      name?: string | undefined;
      language?: Language | undefined;
      theme?: Theme | undefined;
      clickupEmail?: string | null | undefined;
    }) => {
      const body: UpdateMeRequestWire = {
        name: input.name,
        language: input.language,
        theme: input.theme,
        clickup_email: input.clickupEmail,
      };
      return apiFetch<UpdateMeResponseWire>('/me', { method: 'PATCH', body: JSON.stringify(body) });
    },
    onSuccess: (wire) => {
      queryClient.setQueryData<MeResponse>(['me'], (current) =>
        current
          ? {
              ...current,
              name: wire.name,
              language: wire.language,
              theme: wire.theme,
              clickupEmail: wire.clickup_email,
              avatarUrl: wire.avatar_url,
            }
          : current,
      );
    },
  });
}

export function useUploadAvatar() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return apiFetch<UpdateAvatarResponseWire>('/me/avatar', { method: 'POST', body: formData });
    },
    onSuccess: (wire) => {
      queryClient.setQueryData<MeResponse>(['me'], (current) =>
        current ? { ...current, avatarUrl: wire.avatar_url } : current,
      );
      queryClient.invalidateQueries({ queryKey: ['team', 'members'] });
    },
  });
}
