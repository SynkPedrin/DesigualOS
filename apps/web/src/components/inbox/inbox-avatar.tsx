import { EntityAvatar } from '@/components/ui/entity-avatar';

export function InboxAvatar({ name, photoUrl, kind = 'person', size = 'md' }: { name: string; photoUrl?: string | null | undefined; kind?: 'client' | 'person'; size?: 'sm' | 'md' | 'lg' }) {
  if (photoUrl) {
    return <img src={photoUrl} alt={name} className={`${size === 'lg' ? 'size-11' : size === 'sm' ? 'size-6' : 'size-9'} shrink-0 rounded-full object-cover`} referrerPolicy="no-referrer" />;
  }
  return <EntityAvatar name={name} kind={kind} size={size} />;
}
