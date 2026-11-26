import { useEffect, useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { createLiveItineraryBackend, type ItineraryBackend } from '../services/itinerary-v2.service';
import { ItineraryV2 } from './ItineraryV2';

export function ItineraryPage() {
  const { profile } = useAuth();
  const [backend, setBackend] = useState<ItineraryBackend | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setBackend(null);
    if (profile?.id) createLiveItineraryBackend(profile.id, profile.role === 'super_admin')
      .then(value => { if (active) setBackend(value); })
      .catch(e => { if (active) setError(e?.message || '读取权限失败'); });
    return () => { active = false; };
  }, [profile?.id, profile?.role]);
  if (error) return <p className="form-alert">{error}</p>;
  if (!backend) return <div className="table-state">正在读取行程权限…</div>;
  return <ItineraryV2 backend={backend} />;
}
