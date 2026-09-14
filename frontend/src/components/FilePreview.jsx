import { Phone } from 'lucide-react';

export default function FilePreview({ headers = [], rows = [], phoneColumn }) {
  if (!headers.length) return null;
  return (
    <div>
      <span className="upload-label">File preview</span>
      <div className="preview-wrap">
        <table className="preview-table">
          <thead>
            <tr>
              {headers.map((h) => (
                <th key={h} className={h === phoneColumn ? 'is-phone' : ''}>
                  {h === phoneColumn ? <Phone size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} /> : null}
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 5).map((row, i) => (
              <tr key={i}>
                {headers.map((h) => (
                  <td key={h} className={h === phoneColumn ? 'is-phone' : ''} title={String(row[h] || '')}>
                    {String(row[h] || '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="upload-hint">Showing first 5 rows. Scroll the table sideways to see more columns. The highlighted column will be used for phone numbers.</p>
    </div>
  );
}
