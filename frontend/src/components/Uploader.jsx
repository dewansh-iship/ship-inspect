import React, { useRef } from 'react';

export default function Uploader({ onFiles }) {
  const inputRef = useRef();

  return (
    <div className="border-2 border-dashed rounded-2xl p-8 text-center bg-white shadow-sm">
      <p className="mb-3 text-sm">Drop images here or click to browse (up to 100)</p>
      <button
        className="px-4 py-2 rounded-xl border bg-gray-900 text-white"
        onClick={() => inputRef.current?.click()}
      >Select Photos</button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => onFiles(Array.from(e.target.files || []))}
      />
    </div>
  );
}