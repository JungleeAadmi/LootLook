import { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Label } from 'recharts';
import io from 'socket.io-client';
import './index.css';

const API_URL = '/api';
const socket = io(); 

function App() {
  // ... [Keep existing state] ...
  const [items, setItems] = useState([]);
  const [url, setUrl] = useState('');
  const [retention, setRetention] = useState(30);
  const [loading, setLoading] = useState(false);
  const [refreshingId, setRefreshingId] = useState(null);
  const [theme, setTheme] = useState(localStorage.getItem('lootlook-theme') || 'dark');
  const [filterDomain, setFilterDomain] = useState('ALL');
  
  const [selectedItem, setSelectedItem] = useState(null);
  const [editingItem, setEditingItem] = useState(null);
  const [viewImageItem, setViewImageItem] = useState(null); // NEW: For Image Modal
  
  const [history, setHistory] = useState([]);
  const [checkingAll, setCheckingAll] = useState(false); 
  const [globalSync, setGlobalSync] = useState(false);

  // ... [Keep useEffects & Helpers] ...
  useEffect(() => { 
      fetchItems(); 
      document.body.className = theme; 
      socket.on('REFRESH_DATA', () => { fetchItems(); });
      const onFocus = () => fetchItems();
      window.addEventListener('focus', onFocus);
      return () => { window.removeEventListener('focus', onFocus); socket.off('REFRESH_DATA'); };
  }, [theme]);

  const getDomain = (url) => { try { return new URL(url).hostname.replace('www.', ''); } catch (e) { return 'unknown'; } };
  const toggleTheme = () => { const newTheme = theme === 'dark' ? 'colorful' : 'dark'; setTheme(newTheme); localStorage.setItem('lootlook-theme', newTheme); };
  const fetchItems = async () => { setGlobalSync(true); try { const res = await fetch(`${API_URL}/items`); const json = await res.json(); setItems(json.data); } catch (err) { console.error(err); } setTimeout(() => setGlobalSync(false), 800); };
  
  // ... [Keep Add, Delete, Update, Refresh, CheckAll, Copy logic] ...
  const handleAdd = async (e) => { e.preventDefault(); setLoading(true); try { const res = await fetch(`${API_URL}/items`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, retention: parseInt(retention) }) }); if (!res.ok) throw new Error("Failed"); setUrl(''); } catch (err) { alert(err.message); } setLoading(false); };
  const handleDelete = async (id) => { if(!confirm("Delete?")) return; await fetch(`${API_URL}/items/${id}`, { method: 'DELETE' }); };
  const handleUpdate = async (e) => { e.preventDefault(); try { await fetch(`${API_URL}/items/${editingItem.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: editingItem.url, retention: parseInt(editingItem.retention_days) }) }); setEditingItem(null); } catch (err) { alert("Failed"); } };
  const handleRefresh = async (id) => { setRefreshingId(id); try { const res = await fetch(`${API_URL}/refresh/${id}`, { method: 'POST' }); if(res.ok) { if(selectedItem?.id === id) openHistory(items.find(i => i.id === id)); } } catch(err) { alert("Network error"); } setRefreshingId(null); };
  const handleCheckAll = async () => { if (checkingAll) return; if (!confirm(`Check all?`)) return; setCheckingAll(true); for (const item of items) { try { await fetch(`${API_URL}/refresh/${item.id}`, { method: 'POST' }); } catch (e) {} } setCheckingAll(false); };
  const copyToClipboard = (text) => { navigator.clipboard.writeText(text).then(() => alert("Copied!")); };

  const openHistory = async (item) => { setSelectedItem(item); try { const res = await fetch(`${API_URL}/history/${item.id}`); const json = await res.json(); setHistory(json.data.map(p => ({ date: new Date(p.date).toLocaleDateString(undefined, {month:'short', day:'numeric'}), price: p.price }))); } catch (err) { console.error(err); } };
  
  // NEW: Open Image Modal
  const openImage = (e, item) => {
      e.stopPropagation(); // Prevent opening history graph
      setViewImageItem(item);
  };

  const getTrend = (c, p) => (!p || c === p) ? 'neutral' : (c < p ? 'down' : 'up');
  const renderPriceBox = (item) => {
      const trend = getTrend(item.current_price, item.previous_price);
      const hasChange = item.previous_price > 0 && item.current_price !== item.previous_price;
      return ( <div className="price-box"><span className="currency">{item.currency}</span><span className="amount">{item.current_price.toLocaleString()}</span>{hasChange && (<span className={`prev-price ${trend}`}>{trend === 'down' ? 'Was' : 'Low'} {item.previous_price.toLocaleString()}</span>)}</div> );
  };
  
  const graphStats = useMemo(() => { if(history.length === 0) return { min: 0, max: 0 }; const prices = history.map(h => h.price); return { min: Math.min(...prices), max: Math.max(...prices) }; }, [history]);
  
  const domains = [...new Set(items.map(i => getDomain(i.url)))].sort((a, b) => a.localeCompare(b));
  const uniqueDomains = ['ALL', ...domains];
  const filteredItems = filterDomain === 'ALL' ? items : items.filter(i => getDomain(i.url) === filterDomain);

  const getImageSrc = (item) => {
      if (item.screenshot_path) return `${API_URL.replace('/api', '')}/screenshots/${item.screenshot_path}`;
      return item.image_url;
  };

  return (
    <div className={`app-wrapper ${theme}`}>
      <nav className="navbar">
        <div className="nav-content">
            <div className="brand"><div className="logo-box"><img src="/logo.svg" alt="Logo" className="logo-icon" /></div><span className="brand-name">LootLook</span></div>
            <div className="nav-actions">
                <button className={`nav-btn ${checkingAll ? 'pulse' : ''}`} onClick={handleCheckAll} title="Check All">⚡</button>
                <button className={`nav-btn ${globalSync ? 'spin' : ''}`} onClick={fetchItems} title="Sync">↻</button>
                <button className="nav-btn theme-btn" onClick={toggleTheme}>{theme === 'dark' ? '☀️' : '🌙'}</button>
            </div>
        </div>
      </nav>

      <main className="main-content">
        <section className="controls-panel">
            <form onSubmit={handleAdd} className="add-bar">
                <input type="url" placeholder="Paste product link here..." value={url} onChange={(e) => setUrl(e.target.value)} required className="main-input" />
                <div className="add-actions">
                    <select value={retention} onChange={(e) => setRetention(e.target.value)} className="main-select"><option value="30">30 Days</option><option value="365">1 Year</option></select>
                    <button type="submit" disabled={loading} className="primary-btn">{loading ? 'Adding...' : 'Track'}</button>
                </div>
            </form>
            <div className="filter-bar"><label>Filter:</label><select onChange={(e) => setFilterDomain(e.target.value)} value={filterDomain} className="filter-select">{uniqueDomains.map(d => <option key={d} value={d}>{d}</option>)}</select></div>
        </section>

        <section className="items-grid">
            {filteredItems.map(item => (
                <article key={item.id} className={`item-card trend-${getTrend(item.current_price, item.previous_price)}`}>
                    {/* CARD MEDIA - CLICK TO VIEW IMAGE */}
                    <div className="card-media" onClick={(e) => openImage(e, item)}>
                        <div className="img-bg" style={{backgroundImage: `url(${getImageSrc(item)})`}}></div>
                        <span className="graph-tag">View Snip</span>
                    </div>
                    
                    {/* CARD BODY - CLICK TO VIEW HISTORY */}
                    <div className="card-body" onClick={() => openHistory(item)}>
                        <h3 title={item.name}>{item.name}</h3>
                        {renderPriceBox(item)}
                        <div className="meta-info">
                            <span className="badge">{getDomain(item.url)}</span>
                            <span className="badge">{item.date_added ? new Date(item.date_added).toLocaleDateString(undefined, {day:'2-digit', month:'short'}) : 'N/A'}</span>
                        </div>
                    </div>
                    
                    <div className="card-actions">
                        <button onClick={() => handleRefresh(item.id)} disabled={refreshingId === item.id} className="action-btn check">{refreshingId === item.id ? '...' : 'Check'}</button>
                        <a href={item.url} target="_blank" rel="noreferrer" className="action-btn visit">Visit</a>
                        <button onClick={() => setEditingItem(item)} className="action-btn edit">Edit</button>
                        <button onClick={() => handleDelete(item.id)} className="action-btn remove">Remove</button>
                    </div>
                </article>
            ))}
            {items.length === 0 && !loading && <div className="empty-state">No items yet. Add one above!</div>}
        </section>
      </main>

      {/* HISTORY MODAL */}
      {selectedItem && (<div className="modal-backdrop" onClick={() => setSelectedItem(null)}><div className="modal-box" onClick={e => e.stopPropagation()}><div className="modal-head"><h3>History</h3><button onClick={() => setSelectedItem(null)}>×</button></div><div className="modal-body graph-body"><ResponsiveContainer width="100%" height={300}><LineChart data={history} margin={{ top: 20, right: 20, bottom: 5, left: 0 }}><XAxis dataKey="date" stroke="currentColor" fontSize={12} /><YAxis stroke="currentColor" domain={['auto', 'auto']} /><Tooltip contentStyle={{backgroundColor: 'var(--bg-panel)', border:'none', color:'var(--text-main)'}} /><Line type="monotone" dataKey="price" stroke="var(--primary)" strokeWidth={3} dot={{r: 4}} /><ReferenceLine y={graphStats.min} stroke="var(--accent-green)" strokeDasharray="3 3"><Label value={`Min: ${graphStats.min}`} position="insideBottomRight" fill="var(--accent-green)" fontSize={10} /></ReferenceLine><ReferenceLine y={graphStats.max} stroke="var(--danger)" strokeDasharray="3 3"><Label value={`Max: ${graphStats.max}`} position="insideTopRight" fill="var(--danger)" fontSize={10} /></ReferenceLine></LineChart></ResponsiveContainer></div></div></div>)}
      
      {/* EDIT MODAL */}
      {editingItem && (<div className="modal-backdrop" onClick={() => setEditingItem(null)}><div className="modal-box" onClick={e => e.stopPropagation()}><div className="modal-head"><h3>Edit</h3><button onClick={() => setEditingItem(null)}>×</button></div><form onSubmit={handleUpdate} className="modal-body form-body"><div className="form-group"><label>Link</label><div className="input-group"><input value={editingItem.url} onChange={e => setEditingItem({...editingItem, url: e.target.value})} /><button type="button" onClick={() => copyToClipboard(editingItem.url)}>Copy</button></div></div><div className="form-group"><label>Retention</label><select value={editingItem.retention_days} onChange={e => setEditingItem({...editingItem, retention_days: e.target.value})}><option value="30">30 Days</option><option value="365">1 Year</option></select></div><button type="submit" className="save-btn">Save</button></form></div></div>)}
      
      {/* IMAGE MODAL (NEW) */}
      {viewImageItem && (
        <div className="modal-backdrop" onClick={() => setViewImageItem(null)}>
            <div className="modal-box image-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-head">
                    <h3>Page Snip</h3>
                    <button onClick={() => setViewImageItem(null)}>×</button>
                </div>
                <div className="modal-body" style={{padding: 0, display: 'flex', justifyContent: 'center', backgroundColor: '#000'}}>
                    <img 
                        src={getImageSrc(viewImageItem)} 
                        alt="Page Snip" 
                        style={{maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain'}} 
                    />
                </div>
            </div>
        </div>
      )}
    </div>
  );
}

export default App;