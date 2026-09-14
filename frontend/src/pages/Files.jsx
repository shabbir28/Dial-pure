import { useEffect, useState } from 'react';
import api from '../services/api';
import { formatDate, formatNumber } from '../utils/format';

export default function Files() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    api.get('/files', { params: { pageSize: 50 } }).then((r) => setItems(r.data.items));
  }, []);
  return (
    <div>
      <h2 className="page-title">Files</h2>
      <p className="page-sub">Central registry for uploads and generated exports.</p>
      <div className="card">
        <table className="data-table">
          <thead>
            <tr><th>Filename</th><th>Type</th><th>Size</th><th>Rows</th><th>Checksum</th><th>Uploaded</th></tr>
          </thead>
          <tbody>
            {items.map((f) => (
              <tr key={f.id}>
                <td>{f.original_filename}</td>
                <td>{f.file_type}</td>
                <td>{formatNumber(f.file_size_bytes)}</td>
                <td>{formatNumber(f.row_count)}</td>
                <td>{f.checksum_sha256?.slice(0, 12)}</td>
                <td>{formatDate(f.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
