import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import FileDrop from '../components/FileDrop';
import FilePreview from '../components/FilePreview';
import Button from '../components/Button';
import { useToast } from '../components/Toast';
import { formatNumber } from '../utils/format';
import { MAX_UPLOAD_BYTES, isCsvFile, isXlsxFile, previewCsvFile, previewXlsxFile } from '../utils/upload';

export default function NewScrub() {
  const toast = useToast();
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState([]);
  const [campaignId, setCampaignId] = useState('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [phoneColumn, setPhoneColumn] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);

  useEffect(() => {
    api.get('/campaigns', { params: { pageSize: 100, status: 'active' } }).then((r) => {
      const items = r.data.items || [];
      setCampaigns(items);
      setCampaignId(items[0]?.id || '');
    });
  }, []);

  async function onFile(next) {
    if (next.size > MAX_UPLOAD_BYTES) {
      toast.push('File is larger than 500 MB.');
      return;
    }
    setFile(next);
    try {
      if (isCsvFile(next)) {
        const data = await previewCsvFile(next);
        setPreview(data);
        setPhoneColumn(data.suggestedPhoneColumn || '');
        return;
      }
      if (isXlsxFile(next)) {
        const data = await previewXlsxFile(next);
        setPreview(data);
        setPhoneColumn(data.suggestedPhoneColumn || data.headers?.[0] || '');
        return;
      }
      // Unknown file type fallback
      setPreview({ headers: ['Phone No'], sampleRows: [], suggestedPhoneColumn: 'Phone No' });
      setPhoneColumn('Phone No');
    } catch (error) {
      toast.push(error.message);
    }
  }

  async function start() {
    if (!file || !campaignId || !phoneColumn) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.push('File is larger than 500 MB.');
      return;
    }
    setBusy(true);
    setUploadPercent(0);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('campaignId', campaignId);
      fd.append('phoneColumn', phoneColumn);
      const res = await api.post('/scrub-jobs', fd, {
        onUploadProgress: (event) => {
          if (!event.total) return;
          setUploadPercent(Math.min(99, Math.round((event.loaded / event.total) * 100)));
        },
      });
      setUploadPercent(100);
      const prior = res.data.priorSameFile?.[0];
      toast.push(prior
        ? {
            title: 'Same file again',
            description: `This file was already scrubbed as ${prior.job_number}. Results match unless the campaign list changed.`,
          }
        : { title: 'Job Started', description: 'Processing your file…' });
      navigate(`/jobs/${res.data.id}`);
    } catch (error) {
      toast.push(error.message);
    } finally {
      setBusy(false);
      setUploadPercent(0);
    }
  }

  const selected = campaigns.find((c) => c.id === campaignId);

  return (
    <div>
      <h2 className="page-title">New scrub</h2>
      <p className="page-sub">
        Select a campaign, upload leads, choose the phone column, then start.
      </p>
      <div className="card upload-panel">
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Campaign</label>
          <select className="input" value={campaignId} onChange={(e) => setCampaignId(e.target.value)} disabled={!campaigns.length}>
            {campaigns.length === 0 ? (
              <option value="">No campaigns yet</option>
            ) : campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.campaign_code} · {c.name}
              </option>
            ))}
          </select>
          {campaigns.length === 0 ? (
            <p className="upload-hint">Create a campaign first, then come back here to upload and scrub.</p>
          ) : selected && (
            <p className="upload-hint">
              {formatNumber(selected.active_unique_numbers)} numbers already on this campaign
            </p>
          )}
        </div>

        <FileDrop file={file} onFile={onFile} />

        {preview && (
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Phone number column</label>
            <input
              className="input"
              list="scrub-phone-columns"
              value={phoneColumn}
              onChange={(e) => setPhoneColumn(e.target.value)}
              placeholder="Phone No"
            />
            <datalist id="scrub-phone-columns">
              {preview.headers.map((h) => <option key={h} value={h} />)}
            </datalist>
            <p className="upload-hint">Column containing phone numbers. Auto-detected from the file preview.</p>
          </div>
        )}

        {preview?.sampleRows?.length > 0 && (
          <FilePreview headers={preview.headers} rows={preview.sampleRows} phoneColumn={phoneColumn} />
        )}

        <div>
          <Button type="button" disabled={busy || !file || !phoneColumn || !campaignId} onClick={start}>
            {busy ? `Uploading… ${uploadPercent}%` : 'Start uploading'}
          </Button>
          {busy && (
            <div style={{ marginTop: 10, height: 6, borderRadius: 4, background: 'var(--color-border, #e2e8f0)', overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${uploadPercent}%`,
                  background: 'var(--color-primary, #6366f1)',
                  borderRadius: 4,
                  transition: 'width 0.2s ease',
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
