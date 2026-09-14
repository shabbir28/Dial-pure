import { useState } from 'react';
import { FileSpreadsheet, Upload } from 'lucide-react';
import { formatBytes } from '../utils/format';

export default function FileDrop({ onFile, file }) {
  const [active, setActive] = useState(false);

  function handle(files) {
    if (files?.[0]) onFile(files[0]);
  }

  return (
    <div>
      <span className="upload-label">Upload file</span>
      <label
        className={`dropzone ${active ? 'is-active' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setActive(true);
        }}
        onDragLeave={() => setActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setActive(false);
          handle(e.dataTransfer.files);
        }}
      >
        <input type="file" accept=".csv,.xlsx" hidden onChange={(e) => handle(e.target.files)} />
        {file ? <FileSpreadsheet size={22} /> : <Upload size={22} />}
        {file ? (
          <>
            <strong>{file.name}</strong>
            <span>{formatBytes(file.size)} · Click or drop another file to replace</span>
          </>
        ) : (
          <>
            <strong>Drag CSV/XLSX here, or <span className="browse">browse</span></strong>
            <span>CSV or XLSX, up to 500 MB</span>
          </>
        )}
      </label>
    </div>
  );
}
