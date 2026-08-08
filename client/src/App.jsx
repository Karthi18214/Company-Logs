import React, { useState, useEffect, useRef, Component } from 'react';

// Error Boundary to prevent full-page white-screen crashes
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif',
          padding: '2rem',
          textAlign: 'center',
          backgroundColor: '#f8fafc'
        }}>
          <div style={{
            backgroundColor: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: '12px',
            padding: '2rem',
            maxWidth: '420px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.06)'
          }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>⚠️</div>
            <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.25rem', color: '#0f172a' }}>Something went wrong</h2>
            <p style={{ color: '#64748b', fontSize: '14px', margin: '0 0 1.25rem' }}>
              An unexpected error occurred. Please reload the app.
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{
                backgroundColor: '#f97316',
                color: '#fff',
                border: 'none',
                padding: '0.7rem 1.5rem',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// API Fetch wrapper — attaches JWT tokens and handles 401 auto-logout
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

const apiFetch = async (url, options = {}) => {
  const token = localStorage.getItem('sbt_session_token');
  const headers = { ...options.headers };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const targetUrl = url.startsWith('/api') ? `${API_BASE_URL}${url}` : url;

  const res = await fetch(targetUrl, {
    ...options,
    headers
  });

  if (res.status === 401 && token) {
    // Token expired or invalid — clear session and reload to login
    localStorage.removeItem('sbt_session_user');
    localStorage.removeItem('sbt_session_role');
    localStorage.removeItem('sbt_session_token');
    window.location.reload();
  }

  return res;
};

// Compression Utility
const compressImage = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        const MAX_WIDTH = 800;
        if (width > MAX_WIDTH) {
          height = (height * MAX_WIDTH) / width;
          width = MAX_WIDTH;
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (blob) {
              const compressedFile = new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".jpg", {
                type: 'image/jpeg',
                lastModified: Date.now()
              });
              resolve(compressedFile);
            } else {
              reject(new Error('Compression blob generation failed'));
            }
          },
          'image/jpeg',
          0.70 // 70% quality yields highly readable chits under 100KB
        );
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
};

// IndexedDB Database Manager for Offline Queueing
const openDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('SiteBillTrackerDB', 2);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('offline_expenses')) {
        db.createObjectStore('offline_expenses', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('offline_income')) {
        db.createObjectStore('offline_income', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('offline_expenditures')) {
        db.createObjectStore('offline_expenditures', { keyPath: 'id' });
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
};

const saveOfflineItem = async (storeName, item) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.put(item);
    request.onsuccess = () => resolve();
    request.onerror = (e) => reject(e.target.error);
  });
};

const getOfflineItems = async (storeName) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.getAll();
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
};

const deleteOfflineItem = async (storeName, id) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = (e) => reject(e.target.error);
  });
};

const sha256 = async (message) => {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
};

export default function App() {
  const todayStr = new Date().toISOString().split('T')[0];

  // Routing State: 'role-select', 'supervisor-login', 'supervisor-dashboard', 'admin-login', 'admin-dashboard'
  const [screen, setScreen] = useState('role-select');
  const [offlineCount, setOfflineCount] = useState(0);
  const [syncingOffline, setSyncingOffline] = useState(false);
  const [supervisorUser, setSupervisorUser] = useState(null);

  // Lists & Config data
  const [supervisors, setSupervisors] = useState([]);
  const [adminExists, setAdminExists] = useState(false);
  const [activeTab, setActiveTab] = useState('logs'); // 'logs', 'supervisors', 'labourers'
  const [adminLogsTab, setAdminLogsTab] = useState('income'); // 'income', 'expenditure', 'bills'

  // Admin Setup & Login form states
  const [adminPin, setAdminPin] = useState('');
  const [confirmAdminPin, setConfirmAdminPin] = useState('');

  // Supervisor Login states
  const [selectedSupId, setSelectedSupId] = useState('');
  const [supPin, setSupPin] = useState('');

  // Supervisor Form states
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [rawFile, setRawFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');

  // Admin view states
  const [expenses, setExpenses] = useState([]);
  const [selectedAdminSup, setSelectedAdminSup] = useState(null); // Selected supervisor { id, name }
  const [filterDate, setFilterDate] = useState(''); // Specific date filter YYYY-MM-DD
  const [filterStatus, setFilterStatus] = useState('all'); // 'all', 'pending', 'verified'
  const [expFilterLabourerId, setExpFilterLabourerId] = useState('all'); // 'all', 'general', or specific labourer id
  const [expFilterOtherSearch, setExpFilterOtherSearch] = useState('');
  const [expFilterStatus, setExpFilterStatus] = useState('all'); // 'all', 'pending', 'verified'

  // Common UI states
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [notification, setNotification] = useState({ show: false, type: '', message: '' });
  const [confirmModal, setConfirmModal] = useState(null);
  const [selectedPhoto, setSelectedPhoto] = useState(null); // Full photo modal state

  // Supervisor management form
  const [newSupName, setNewSupName] = useState('');
  const [newSupPin, setNewSupPin] = useState('');
  const [editingSupervisorPinId, setEditingSupervisorPinId] = useState(null);
  const [newSupervisorPinForEdit, setNewSupervisorPinForEdit] = useState('');

  // Supervisor's own recent bills
  const [myRecentBills, setMyRecentBills] = useState([]);

  // Monthly navigation folder states
  const [selectedAdminMonth, setSelectedAdminMonth] = useState(null); // Selected month folder for Admin (e.g., 'July 2026')
  const [selectedSupervisorMonth, setSelectedSupervisorMonth] = useState(null); // Selected month folder for Supervisor (Bills)
  const [selectedSupervisorIncomeMonth, setSelectedSupervisorIncomeMonth] = useState(null);
  const [selectedSupervisorExpenditureMonth, setSelectedSupervisorExpenditureMonth] = useState(null);

  // Expenditure (Outflow) States
  const [supExpFilterLabourerId, setSupExpFilterLabourerId] = useState('all');
  const [supExpFilterOtherSearch, setSupExpFilterOtherSearch] = useState('');
  const [supExpFilterStatus, setSupExpFilterStatus] = useState('all');
  const [supExpFilterDate, setSupExpFilterDate] = useState('');
  const [isDeleteMode, setIsDeleteMode] = useState(false);
  const [deletingLog, setDeletingLog] = useState(null);

  // Income (Inflow) States
  const [supIncFilterSearch, setSupIncFilterSearch] = useState('');
  const [isIncDeleteMode, setIsIncDeleteMode] = useState(false);
  const [deletingIncLog, setDeletingIncLog] = useState(null);

  // Bills (Receipts) States
  const [supBillFilterStatus, setSupBillFilterStatus] = useState('all');
  const [supBillFilterSearch, setSupBillFilterSearch] = useState('');
  const [isBillDeleteMode, setIsBillDeleteMode] = useState(false);
  const [deletingBillLog, setDeletingBillLog] = useState(null);

  const [supervisorTab, setSupervisorTab] = useState('income'); // 'income', 'expenditure', 'bills'

  // Cash Book States
  const [labourers, setLabourers] = useState([]);
  const [incomeLogs, setIncomeLogs] = useState([]);
  const [expenditureLogs, setExpenditureLogs] = useState([]);
  const [settlements, setSettlements] = useState([]);
  const [salaryInputs, setSalaryInputs] = useState({});
  const [settlementModalData, setSettlementModalData] = useState(null);

  const executeSettlement = async (data) => {
    if (!data) return;
    setActionLoading(true);
    try {
      const res = await apiFetch('/api/settlements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supervisor_id: data.supervisorId,
          supervisor_name: data.supervisorName,
          month: data.report.month,
          salary: data.numericSalary,
          inflow: data.report.inflow,
          outflow: data.report.outflowTotal,
          cash_left: data.report.cashLeft,
          net_salary: data.calculatedNet
        })
      });
      if (res.ok) {
        triggerNotification('success', `Settled ${data.report.month}!`);
        setSettlementModalData(null);
        await fetchSettlements();
      } else {
        triggerNotification('error', 'Failed to save settlement.');
      }
    } catch (err) {
      triggerNotification('error', 'Connection error.');
    } finally {
      setActionLoading(false);
    }
  };

  // Supervisor Cash Book Forms
  const [incomeAmount, setIncomeAmount] = useState('');
  const [incomeDate, setIncomeDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [incomeNote, setIncomeNote] = useState('');

  const [expenditureAmount, setExpenditureAmount] = useState('');
  const [expenditureType, setExpenditureType] = useState('labour'); // 'labour' or 'general'
  const [selectedLabourerId, setSelectedLabourerId] = useState('');
  const [selectedToSupervisorId, setSelectedToSupervisorId] = useState('');
  const [otherLabourerName, setOtherLabourerName] = useState('');
  const [expenditureNote, setExpenditureNote] = useState('');
  const [expenditureDate, setExpenditureDate] = useState(() => new Date().toISOString().split('T')[0]);

  // Admin Cash Book Forms
  const [newLabourerName, setNewLabourerName] = useState('');
  const [selectedLookupLabourerId, setSelectedLookupLabourerId] = useState('');
  const [lookupOtherSearch, setLookupOtherSearch] = useState('');




  const syncOfflineQueue = async () => {
    if (syncingOffline) return;
    
    const [expQueue, incQueue, outflowQueue] = await Promise.all([
      getOfflineItems('offline_expenses'),
      getOfflineItems('offline_income'),
      getOfflineItems('offline_expenditures')
    ]);

    const totalToSync = expQueue.length + incQueue.length + outflowQueue.length;
    if (totalToSync === 0) {
      setOfflineCount(0);
      return;
    }

    setSyncingOffline(true);
    triggerNotification('info', `Syncing ${totalToSync} offline log(s)...`);

    let successCount = 0;

    // 1. Sync Cash Inflows (Income)
    for (const item of incQueue) {
      try {
        const res = await apiFetch('/api/income', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            supervisor_id: item.supervisor_id,
            supervisor_name: item.supervisor_name,
            amount: item.amount,
            date: item.date,
            note: item.note
          })
        });
        if (res.ok) {
          await deleteOfflineItem('offline_income', item.id);
          successCount++;
        }
      } catch (err) {
        console.error('Failed to sync offline income:', err);
        break;
      }
    }

    // 2. Sync Outflows (Expenditures)
    for (const item of outflowQueue) {
      try {
        const res = await apiFetch('/api/expenditures', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            supervisor_id: item.supervisor_id,
            supervisor_name: item.supervisor_name,
            amount: item.amount,
            type: item.type,
            labourer_id: item.labourer_id,
            labourer_name: item.labourer_name,
            note: item.note,
            date: item.date
          })
        });
        if (res.ok) {
          await deleteOfflineItem('offline_expenditures', item.id);
          successCount++;
        }
      } catch (err) {
        console.error('Failed to sync offline expenditure:', err);
        break;
      }
    }

    // 3. Sync Receipt Bills (Expenses)
    for (const item of expQueue) {
      try {
        const formData = new FormData();
        formData.append('supervisor_id', item.supervisor_id);
        formData.append('supervisor_name', item.supervisor_name);
        formData.append('amount', item.amount);
        formData.append('note', item.note);
        formData.append('date', item.date);
        
        const file = new File([item.fileBlob], item.fileName, { type: item.fileType });
        formData.append('file', file);

        const res = await apiFetch('/api/expenses', {
          method: 'POST',
          body: formData
        });

        if (res.ok) {
          await deleteOfflineItem('offline_expenses', item.id);
          successCount++;
        }
      } catch (err) {
        console.error('Failed to sync offline expense:', err);
        break;
      }
    }

    const [postExp, postInc, postOutflow] = await Promise.all([
      getOfflineItems('offline_expenses'),
      getOfflineItems('offline_income'),
      getOfflineItems('offline_expenditures')
    ]);
    
    setOfflineCount(postExp.length + postInc.length + postOutflow.length);
    setSyncingOffline(false);

    if (successCount > 0) {
      triggerNotification('success', `Successfully synced ${successCount} record(s)!`);
      const savedRole = localStorage.getItem('sbt_session_role');
      const savedUser = localStorage.getItem('sbt_session_user');
      if (savedRole === 'supervisor' && savedUser) {
        const parsed = JSON.parse(savedUser);
        fetchSupervisorRecentBills(parsed.id);
        fetchSupervisorCashBookData(parsed.id);
      }
    }
  };

  useEffect(() => {
    Promise.all([
      getOfflineItems('offline_expenses'),
      getOfflineItems('offline_income'),
      getOfflineItems('offline_expenditures')
    ]).then(([expQueue, incQueue, outflowQueue]) => {
      const total = expQueue.length + incQueue.length + outflowQueue.length;
      setOfflineCount(total);
      if (total > 0 && navigator.onLine) {
        syncOfflineQueue();
      }
    });

    const handleOnlineStatus = () => {
      if (navigator.onLine) {
        syncOfflineQueue();
      }
    };

    window.addEventListener('online', handleOnlineStatus);
    return () => {
      window.removeEventListener('online', handleOnlineStatus);
    };
  }, [syncingOffline]);

  // Fetch initial configs on mount
  useEffect(() => {
    fetchSupervisors();
    checkAdminConfig();

    // Auto-restore session based on role
    const savedRole = localStorage.getItem('sbt_session_role');
    if (savedRole === 'supervisor') {
      const savedUser = localStorage.getItem('sbt_session_user');
      if (savedUser) {
        const parsed = JSON.parse(savedUser);
        setSupervisorUser(parsed);
        setScreen('supervisor-dashboard');
        setSupervisorTab('income');
        fetchSupervisorRecentBills(parsed.id);
        fetchSupervisorCashBookData(parsed.id);
      }
    } else if (savedRole === 'admin') {
      setScreen('admin-dashboard');
      fetchAdminCashBookData();
    }
  }, []);

  const navStateRef = useRef(null);
  const notifTimerRef = useRef(null);

  // Sync state changes to browser history
  useEffect(() => {
    // Determine the current navigation state footprint
    const currentState = {
      screen,
      selectedSupervisorExpenditureMonth,
      deletingLogId: deletingLog ? deletingLog.id : null,
      selectedSupervisorIncomeMonth,
      deletingIncLogId: deletingIncLog ? deletingIncLog.id : null,
      selectedSupervisorMonth,
      deletingBillLogId: deletingBillLog ? deletingBillLog.id : null,
      selectedAdminSupId: selectedAdminSup ? selectedAdminSup.id : null,
      selectedAdminMonth,
    };

    // Initialize ref on first run to point to replaced initial state
    if (!navStateRef.current) {
      navStateRef.current = currentState;
      window.history.replaceState(currentState, '');
      return;
    }

    // Skip pushing duplicate entries
    if (JSON.stringify(navStateRef.current) === JSON.stringify(currentState)) {
      return;
    }

    const prevScreen = navStateRef.current ? navStateRef.current.screen : null;
    const isLoginTransition = prevScreen === 'role-selection' || prevScreen === 'supervisor-login' || prevScreen === 'admin-login';

    navStateRef.current = currentState;
    if (isLoginTransition || currentState.screen === 'role-selection' || currentState.screen === 'supervisor-login' || currentState.screen === 'admin-login') {
      window.history.replaceState(currentState, '');
    } else {
      window.history.pushState(currentState, '');
    }
  }, [
    screen,
    selectedSupervisorExpenditureMonth,
    deletingLog,
    selectedSupervisorIncomeMonth,
    deletingIncLog,
    selectedSupervisorMonth,
    deletingBillLog,
    selectedAdminSup,
    selectedAdminMonth,
  ]);

  // Handle hardware/mobile back button presses (popstate event)
  useEffect(() => {
    const handlePopState = (event) => {
      const state = event.state;
      if (!state) return;

      const savedRole = localStorage.getItem('sbt_session_role');
      if (savedRole && (state.screen === 'role-selection' || state.screen === 'supervisor-login' || state.screen === 'admin-login')) {
        const dashboardScreen = savedRole === 'admin' ? 'admin-dashboard' : 'supervisor-dashboard';
        window.history.pushState({ ...state, screen: dashboardScreen }, '');
        setScreen(dashboardScreen);
        return;
      }

      navStateRef.current = state;

      // Restore simple screen and month variables
      setScreen(state.screen);
      setSelectedSupervisorExpenditureMonth(state.selectedSupervisorExpenditureMonth);
      setSelectedSupervisorIncomeMonth(state.selectedSupervisorIncomeMonth);
      setSelectedSupervisorMonth(state.selectedSupervisorMonth);
      setSelectedAdminMonth(state.selectedAdminMonth);

      // Restore deletingLog from loaded list if available
      if (state.deletingLogId) {
        const found = expenditureLogs.find(x => x.id === state.deletingLogId);
        setDeletingLog(found || null);
      } else {
        setDeletingLog(null);
      }

      // Restore deletingIncLog
      if (state.deletingIncLogId) {
        const found = incomeLogs.find(x => x.id === state.deletingIncLogId);
        setDeletingIncLog(found || null);
      } else {
        setDeletingIncLog(null);
      }

      // Restore deletingBillLog
      if (state.deletingBillLogId) {
        const found = myRecentBills.find(x => x.id === state.deletingBillLogId);
        setDeletingBillLog(found || null);
      } else {
        setDeletingBillLog(null);
      }

      // Restore selectedAdminSup
      if (state.selectedAdminSupId) {
        const found = supervisors.find(x => x.id === state.selectedAdminSupId);
        setSelectedAdminSup(found || null);
      } else {
        setSelectedAdminSup(null);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [expenditureLogs, incomeLogs, myRecentBills, supervisors]);

  const triggerNotification = (type, message) => {
    clearTimeout(notifTimerRef.current);
    setNotification({ show: true, type, message });
    notifTimerRef.current = setTimeout(() => {
      setNotification({ show: false, type: '', message: '' });
    }, 4000);
  };

  const checkAdminConfig = async () => {
    try {
      const res = await apiFetch('/api/admin/config');
      if (res.ok) {
        const data = await res.json();
        setAdminExists(data.exists);
      }
    } catch (err) {
      console.error('Error checking admin config:', err);
    }
  };

  const fetchSupervisors = async () => {
    try {
      const res = await apiFetch('/api/supervisors');
      if (res.ok) {
        const data = await res.json();
        setSupervisors(data);
        localStorage.setItem('sbt_supervisors', JSON.stringify(data));
      }
    } catch (err) {
      console.error('Error fetching supervisors list:', err);
      const cached = localStorage.getItem('sbt_supervisors');
      if (cached) {
        setSupervisors(JSON.parse(cached));
      }
    }
  };

  const fetchExpensesList = async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/expenses');
      if (res.ok) {
        const data = await res.json();
        setExpenses(data);
      }
    } catch (err) {
      console.error('Error fetching expenses:', err);
    } finally {
      setLoading(false);
    }
  };


  const fetchLabourers = async () => {
    try {
      const res = await apiFetch('/api/labourers');
      if (res.ok) {
        const data = await res.json();
        setLabourers(data);
        localStorage.setItem('sbt_labourers', JSON.stringify(data));
      }
    } catch (err) {
      console.error('fetchLabourers error:', err);
      const cached = localStorage.getItem('sbt_labourers');
      if (cached) {
        setLabourers(JSON.parse(cached));
      }
    }
  };

  const fetchSettlements = async () => {
    try {
      const res = await apiFetch('/api/settlements');
      if (res.ok) {
        const data = await res.json();
        setSettlements(data);
      }
    } catch (err) {
      console.error('fetchSettlements error:', err);
    }
  };

  const fetchSupervisorCashBookData = async (supId) => {
    setLoading(true);
    try {
      const [expListRes, labRes, setRes, incomeRes, expRes] = await Promise.all([
        apiFetch('/api/expenses'),
        apiFetch('/api/labourers'),
        apiFetch('/api/settlements'),
        apiFetch(`/api/income?supervisor_id=${supId}`),
        apiFetch(`/api/expenditures?supervisor_id=${supId}`)
      ]);

      const [expList, labs, sets, incomeData, expData] = await Promise.all([
        expListRes.ok ? expListRes.json() : [],
        labRes.ok ? labRes.json() : [],
        setRes.ok ? setRes.json() : [],
        incomeRes.ok ? incomeRes.json() : [],
        expRes.ok ? expRes.json() : []
      ]);

      setExpenses(expList);
      setLabourers(labs);
      setSettlements(sets);
      setIncomeLogs(incomeData);
      setExpenditureLogs(expData);

      localStorage.setItem(`sbt_expenses`, JSON.stringify(expList));
      localStorage.setItem(`sbt_labourers`, JSON.stringify(labs));
      localStorage.setItem(`sbt_settlements`, JSON.stringify(sets));
      localStorage.setItem(`sbt_income_${supId}`, JSON.stringify(incomeData));
      localStorage.setItem(`sbt_expenditures_${supId}`, JSON.stringify(expData));
    } catch (err) {
      console.error('fetchSupervisorCashBookData error:', err);
      const cachedExpenses = localStorage.getItem(`sbt_expenses`);
      const cachedLabourers = localStorage.getItem(`sbt_labourers`);
      const cachedSettlements = localStorage.getItem(`sbt_settlements`);
      const cachedIncome = localStorage.getItem(`sbt_income_${supId}`);
      const cachedExp = localStorage.getItem(`sbt_expenditures_${supId}`);

      if (cachedExpenses) setExpenses(JSON.parse(cachedExpenses));
      if (cachedLabourers) setLabourers(JSON.parse(cachedLabourers));
      if (cachedSettlements) setSettlements(JSON.parse(cachedSettlements));
      if (cachedIncome) setIncomeLogs(JSON.parse(cachedIncome));
      if (cachedExp) setExpenditureLogs(JSON.parse(cachedExp));
    } finally {
      setLoading(false);
    }
  };

  const fetchAdminCashBookData = async () => {
    setLoading(true);
    try {
      const [expListRes, labRes, setRes, incomeRes, expRes] = await Promise.all([
        apiFetch('/api/expenses'),
        apiFetch('/api/labourers'),
        apiFetch('/api/settlements'),
        apiFetch('/api/income'),
        apiFetch('/api/expenditures')
      ]);

      const [expList, labs, sets, incomeData, expData] = await Promise.all([
        expListRes.ok ? expListRes.json() : [],
        labRes.ok ? labRes.json() : [],
        setRes.ok ? setRes.json() : [],
        incomeRes.ok ? incomeRes.json() : [],
        expRes.ok ? expRes.json() : []
      ]);

      setExpenses(expList);
      setLabourers(labs);
      setSettlements(sets);
      setIncomeLogs(incomeData);
      setExpenditureLogs(expData);
    } catch (err) {
      console.error('fetchAdminCashBookData error:', err);
    } finally {
      setLoading(false);
    }
  };
  const getSupervisorMonthlySettlements = (supId) => {
    if (!supId) return { monthlyReports: [], currentInHandBalance: 0 };

    const supIncome = incomeLogs.filter(i => i.supervisor_id === supId);
    const supExpenditure = expenditureLogs.filter(e => e.supervisor_id === supId);
    const allBillsList = expenses.length > 0 ? expenses : myRecentBills;
    const supBills = allBillsList.filter(b => b.supervisor_id === supId || (!b.supervisor_id && supervisorUser && supervisorUser.id === supId));
    const supSettlements = settlements.filter(s => s.supervisor_id === supId);

    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];

    const getMonthName = (dateStr) => {
      if (!dateStr) return null;
      const parts = dateStr.split('-');
      if (parts.length < 2) return null;
      const dateObj = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, 1);
      return dateObj.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    };

    const parseMonthYearString = (myStr) => {
      const parts = myStr.split(' ');
      const mIndex = monthNames.indexOf(parts[0]);
      const year = parseInt(parts[1], 10);
      return new Date(year, mIndex, 1);
    };

    // Collect all unique months
    const allMonthsSet = new Set();
    supIncome.forEach(i => { const m = getMonthName(i.date); if (m) allMonthsSet.add(m); });
    supExpenditure.forEach(e => { const m = getMonthName(e.date); if (m) allMonthsSet.add(m); });
    supBills.forEach(b => { const m = getMonthName(b.date); if (m) allMonthsSet.add(m); });
    supSettlements.forEach(s => { if (s.month) allMonthsSet.add(s.month); });

    const sortedMonths = Array.from(allMonthsSet).sort((a, b) => {
      return parseMonthYearString(a).getTime() - parseMonthYearString(b).getTime();
    });

    let runningOpeningBalance = 0;
    const monthlyReports = [];

    for (const monthStr of sortedMonths) {
      const monthlyInflow = supIncome
        .filter(i => getMonthName(i.date) === monthStr)
        .reduce((sum, i) => sum + parseFloat(i.amount || 0), 0);

      const monthlyOutflowExpendList = supExpenditure.filter(e => getMonthName(e.date) === monthStr);
      const monthlyOutflowBillsList = supBills.filter(b => getMonthName(b.date) === monthStr);

      const monthlyOutflowExpend = monthlyOutflowExpendList.reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);
      const monthlyOutflowBills = monthlyOutflowBillsList.reduce((sum, b) => sum + parseFloat(b.amount || 0), 0);

      const unverifiedExpenditures = monthlyOutflowExpendList.filter(e => !e.verified).length;
      const unverifiedBills = monthlyOutflowBillsList.filter(b => !b.verified).length;

      const totalSpent = monthlyOutflowExpend + monthlyOutflowBills;
      const closingBalance = runningOpeningBalance + monthlyInflow - totalSpent;

      const settlementRecord = supSettlements.find(s => s.month === monthStr);
      const isSettled = !!settlementRecord;
      const salary = settlementRecord ? parseFloat(settlementRecord.salary) : 0;
      const netSalary = isSettled ? (closingBalance - salary) : 0;

      monthlyReports.push({
        month: monthStr,
        openingBalance: runningOpeningBalance,
        inflow: monthlyInflow,
        outflowExpenditures: monthlyOutflowExpend,
        outflowBills: monthlyOutflowBills,
        outflowTotal: totalSpent,
        unverifiedExpenditures,
        unverifiedBills,
        cashLeft: closingBalance,
        isSettled,
        salary,
        netSalary,
        settlementRecord
      });

      if (isSettled) {
        runningOpeningBalance = Math.max(0, closingBalance - salary);
      } else {
        runningOpeningBalance = Math.max(0, closingBalance);
      }
    }

    const totalIn = supIncome.reduce((sum, i) => sum + parseFloat(i.amount || 0), 0);
    const totalExpend = supExpenditure.reduce((sum, e) => sum + parseFloat(e.amount || 0), 0);
    const totalBills = supBills.reduce((sum, b) => sum + parseFloat(b.amount || 0), 0);
    const totalSettledSalaries = supSettlements.reduce((sum, s) => sum + parseFloat(s.salary || 0), 0);
    
    const lastReport = monthlyReports[monthlyReports.length - 1];
    const currentInHandBalance = lastReport ? (lastReport.isSettled ? Math.max(0, lastReport.cashLeft - lastReport.salary) : lastReport.cashLeft) : 0;

    return {
      monthlyReports,
      currentInHandBalance
    };
  };

  const fetchSupervisorRecentBills = async (supervisorId) => {
    try {
      const res = await apiFetch(`/api/expenses?supervisor_id=${supervisorId}`);
      if (res.ok) {
        const data = await res.json();
        setMyRecentBills(data);
        localStorage.setItem(`sbt_recent_bills_${supervisorId}`, JSON.stringify(data));
      }
    } catch (err) {
      console.error('Error fetching recent bills:', err);
      const cached = localStorage.getItem(`sbt_recent_bills_${supervisorId}`);
      if (cached) {
        setMyRecentBills(JSON.parse(cached));
      }
    }
  };

  // Logouts
  const handleLogout = () => {
    setSupervisorUser(null);
    localStorage.removeItem('sbt_session_user');
    localStorage.removeItem('sbt_session_role');
    localStorage.removeItem('sbt_session_token');
    setScreen('role-select');
    // Clear forms
    setSelectedSupId('');
    setSupPin('');
    setAdminPin('');
    setConfirmAdminPin('');
    setSelectedAdminSup(null);
    setFilterDate('');
    setFilterStatus('all');
    setSelectedAdminMonth(null);
    setSelectedSupervisorMonth(null);
    setSelectedSupervisorIncomeMonth(null);
    setSelectedSupervisorExpenditureMonth(null);
    setSupervisorTab('income');
    setAdminLogsTab('income');
    setLabourers([]);
    setIncomeLogs([]);
    setExpenditureLogs([]);
    setIncomeAmount('');
    setIncomeNote('');
    setExpenditureAmount('');
    setExpenditureNote('');
    setNewLabourerName('');
    setSelectedLookupLabourerId('');
  };

  // -------------------------------------------------------------
  // HANDLERS
  // -------------------------------------------------------------

  // Admin PIN setup
  const handleAdminSetup = async (e) => {
    e.preventDefault();
    if (adminPin !== confirmAdminPin) {
      triggerNotification('error', 'PINs do not match.');
      return;
    }
    if (adminPin.length < 4) {
      triggerNotification('error', 'PIN must be at least 4 digits.');
      return;
    }
    setActionLoading(true);
    try {
      const res = await apiFetch('/api/admin/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: adminPin })
      });
      if (res.ok) {
        triggerNotification('success', 'Admin PIN set successfully!');
        setAdminExists(true);
        setAdminPin('');
        setConfirmAdminPin('');
      } else {
        const err = await res.json();
        triggerNotification('error', err.error || 'Setup failed.');
      }
    } catch (err) {
      triggerNotification('error', 'Connection error.');
    } finally {
      setActionLoading(false);
    }
  };

  // Admin PIN login
  const handleAdminLogin = async (e) => {
    e.preventDefault();
    setActionLoading(true);
    try {
      const res = await apiFetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: adminPin })
      });
      if (res.ok) {
        const data = await res.json();
        localStorage.setItem('sbt_session_role', 'admin');
        localStorage.setItem('sbt_session_token', data.token);
        setScreen('admin-dashboard');
        fetchAdminCashBookData();
        triggerNotification('success', 'Admin logged in.');
      } else {
        triggerNotification('error', 'Invalid Admin PIN.');
      }
    } catch (err) {
      triggerNotification('error', 'Connection error.');
    } finally {
      setActionLoading(false);
    }
  };

  // Supervisor PIN login
  const handleSupervisorLogin = async (e) => {
    e.preventDefault();
    if (!selectedSupId || !supPin) {
      triggerNotification('error', 'Please select a supervisor and enter PIN.');
      return;
    }
    const sup = supervisors.find(s => s.id === selectedSupId);
    if (!sup) return;

    setActionLoading(true);

    const isOffline = !navigator.onLine;

    if (isOffline) {
      try {
        const pinHash = await sha256(supPin);
        const cachedHash = localStorage.getItem(`sbt_offline_pin_${sup.id}`);
        
        if (cachedHash && cachedHash === pinHash) {
          setSupervisorUser(sup);
          localStorage.setItem('sbt_session_role', 'supervisor');
          localStorage.setItem('sbt_session_user', JSON.stringify(sup));
          localStorage.setItem('sbt_session_token', 'offline-token');
          setScreen('supervisor-dashboard');
          setSupervisorTab('income');
          
          fetchSupervisorRecentBills(sup.id);
          fetchSupervisorCashBookData(sup.id);
          
          triggerNotification('success', `Welcome back, ${sup.name}! (Offline mode)`);
        } else {
          triggerNotification('error', 'Invalid PIN.');
        }
      } catch (err) {
        console.error('Offline authentication error:', err);
        triggerNotification('error', 'Verification failed.');
      } finally {
        setActionLoading(false);
      }
      return;
    }

    try {
      const res = await apiFetch('/api/supervisors/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: sup.name, pin: supPin })
      });
      if (res.ok) {
        const data = await res.json();
        setSupervisorUser(data.supervisor);
        localStorage.setItem('sbt_session_role', 'supervisor');
        localStorage.setItem('sbt_session_user', JSON.stringify(data.supervisor));
        localStorage.setItem('sbt_session_token', data.token);
        
        // Cache the PIN hash locally for offline login
        const pinHash = await sha256(supPin);
        localStorage.setItem(`sbt_offline_pin_${data.supervisor.id}`, pinHash);

        setScreen('supervisor-dashboard');
        setSupervisorTab('income');
        fetchSupervisorRecentBills(data.supervisor.id);
        fetchSupervisorCashBookData(data.supervisor.id);
        triggerNotification('success', `Welcome back, ${data.supervisor.name}!`);
      } else {
        triggerNotification('error', 'Invalid PIN.');
      }
    } catch (err) {
      triggerNotification('error', 'Connection error.');
    } finally {
      setActionLoading(false);
    }
  };

  // File Change & Compress
  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setLoading(true);
    try {
      // Compress immediately using browser canvas utility
      const compressed = await compressImage(file);
      setRawFile(compressed);

      // Load thumbnail preview
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreviewUrl(reader.result);
      };
      reader.readAsDataURL(compressed);
    } catch (err) {
      console.error('Image compression failed:', err);
      triggerNotification('error', 'Could not compress image.');
    } finally {
      setLoading(false);
    }
  };

  // Submit expense record
  const handleExpenseSubmit = async (e) => {
    e.preventDefault();
    if (!rawFile) {
      triggerNotification('error', 'Please snap a bill photo.');
      return;
    }
    if (!amount || parseFloat(amount) <= 0) {
      triggerNotification('error', 'Please enter a valid amount.');
      return;
    }

    setActionLoading(true);
    
    const isOffline = !navigator.onLine;

    if (isOffline) {
      try {
        const offlineItem = {
          id: `offline-${Date.now()}-${Math.floor(Math.random() * 1000000)}`,
          supervisor_id: supervisorUser.id,
          supervisor_name: supervisorUser.name,
          amount: amount,
          note: note,
          date: date,
          fileName: rawFile.name || 'photo.jpg',
          fileType: rawFile.type || 'image/jpeg',
          fileBlob: rawFile
        };
        
        await saveOfflineItem('offline_expenses', offlineItem);
        
        const mockLog = {
          id: offlineItem.id,
          supervisor_id: supervisorUser.id,
          supervisor_name: supervisorUser.name,
          amount: parseFloat(amount),
          note: `[Offline Pending Sync] ${note}`,
          date: date,
          photo_url: previewUrl || '',
          verified: false,
          offline_pending: true
        };
        setMyRecentBills(prev => [mockLog, ...prev]);

        triggerNotification('info', 'Saved offline! Will sync automatically when connection restores.');
        setOfflineCount(prev => prev + 1);

        // Reset form
        setAmount('');
        setNote('');
        setRawFile(null);
        setPreviewUrl('');
      } catch (err) {
        console.error('Failed to save offline chit:', err);
        triggerNotification('error', 'Could not save offline data.');
      } finally {
        setActionLoading(false);
      }
      return;
    }

    try {
      const formData = new FormData();
      formData.append('supervisor_id', supervisorUser.id);
      formData.append('supervisor_name', supervisorUser.name);
      formData.append('amount', amount);
      formData.append('note', note);
      formData.append('date', date);
      formData.append('file', rawFile);

      const res = await apiFetch('/api/expenses', {
        method: 'POST',
        body: formData
      });

      if (res.ok) {
        triggerNotification('success', 'Bill synced successfully.');
        // Reset form
        setAmount('');
        setNote('');
        setRawFile(null);
        setPreviewUrl('');
        // Refresh list
        fetchSupervisorRecentBills(supervisorUser.id);
      } else {
        const err = await res.json();
        triggerNotification('error', err.error || 'Failed to upload expense.');
      }
    } catch (err) {
      console.warn('Network request failed, falling back to offline saving:', err);
      try {
        const offlineItem = {
          id: `offline-${Date.now()}-${Math.floor(Math.random() * 1000000)}`,
          supervisor_id: supervisorUser.id,
          supervisor_name: supervisorUser.name,
          amount: amount,
          note: note,
          date: date,
          fileName: rawFile.name || 'photo.jpg',
          fileType: rawFile.type || 'image/jpeg',
          fileBlob: rawFile
        };
        await saveOfflineItem('offline_expenses', offlineItem);
        
        const mockLog = {
          id: offlineItem.id,
          supervisor_id: supervisorUser.id,
          supervisor_name: supervisorUser.name,
          amount: parseFloat(amount),
          note: `[Offline Pending Sync] ${note}`,
          date: date,
          photo_url: previewUrl || '',
          verified: false,
          offline_pending: true
        };
        setMyRecentBills(prev => [mockLog, ...prev]);

        triggerNotification('info', 'Network issue. Saved offline for background sync.');
        setOfflineCount(prev => prev + 1);

        // Reset form
        setAmount('');
        setNote('');
        setRawFile(null);
        setPreviewUrl('');
      } catch (e) {
        triggerNotification('error', 'Network error. Failed to save offline.');
      }
    } finally {
      setActionLoading(false);
    }
  };

  // Admin verify toggle
  const handleToggleVerify = async (expense) => {
    setActionLoading(true);
    const newVerified = !expense.verified;
    try {
      const res = await apiFetch(`/api/expenses/${expense.id}/toggle`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verified: newVerified })
      });
      if (res.ok) {
        const updated = await res.json();
        // Update list
        setExpenses(prev => prev.map(e => e.id === expense.id ? updated : e));
        triggerNotification('success', newVerified ? 'Receipt marked VERIFIED.' : 'Receipt marked PENDING.');
      } else {
        triggerNotification('error', 'Failed to toggle verification.');
      }
    } catch (err) {
      triggerNotification('error', 'Connection error.');
    } finally {
      setActionLoading(false);
    }
  };

  // Admin verify toggle for expenditure
  const handleToggleVerifyExpenditure = async (exp) => {
    setActionLoading(true);
    const newVerified = !exp.verified;
    try {
      const res = await apiFetch(`/api/expenditures/${exp.id}/toggle`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verified: newVerified })
      });
      if (res.ok) {
        const updated = await res.json();
        // Update list
        setExpenditureLogs(prev => prev.map(e => e.id === exp.id ? updated : e));
        triggerNotification('success', newVerified ? 'Expenditure marked VERIFIED.' : 'Expenditure marked PENDING.');
      } else {
        triggerNotification('error', 'Failed to toggle verification.');
      }
    } catch (err) {
      triggerNotification('error', 'Connection error.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteExpenditure = async (id) => {
    setActionLoading(true);
    try {
      const res = await apiFetch(`/api/expenditures/${id}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        triggerNotification('success', 'Outflow record deleted successfully.');
        await fetchSupervisorCashBookData(supervisorUser.id);
        setDeletingLog(null);
        setIsDeleteMode(false);
      } else {
        const errData = await res.json();
        triggerNotification('error', errData.error || 'Failed to delete record.');
      }
    } catch (err) {
      console.error('Delete expenditure error:', err);
      triggerNotification('error', 'Connection error.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteIncome = async (id) => {
    setActionLoading(true);
    try {
      const res = await apiFetch(`/api/income/${id}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        triggerNotification('success', 'Cash received record deleted successfully.');
        await fetchSupervisorCashBookData(supervisorUser.id);
        setDeletingIncLog(null);
        setIsIncDeleteMode(false);
      } else {
        const errData = await res.json();
        triggerNotification('error', errData.error || 'Failed to delete record.');
      }
    } catch (err) {
      console.error('Delete income error:', err);
      triggerNotification('error', 'Connection error.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteBill = async (id) => {
    setActionLoading(true);
    try {
      const res = await apiFetch(`/api/expenses/${id}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        triggerNotification('success', 'Bill chit deleted successfully.');
        await fetchSupervisorRecentBills(supervisorUser.id);
        setDeletingBillLog(null);
        setIsBillDeleteMode(false);
      } else {
        const errData = await res.json();
        triggerNotification('error', errData.error || 'Failed to delete bill.');
      }
    } catch (err) {
      console.error('Delete bill error:', err);
      triggerNotification('error', 'Connection error.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleIncomeSubmit = async (e) => {
    e.preventDefault();
    if (!incomeAmount || !incomeDate) {
      triggerNotification('error', 'Please enter amount and date.');
      return;
    }
    
    setActionLoading(true);

    const isOffline = !navigator.onLine;
    if (isOffline) {
      try {
        const offlineItem = {
          id: `offline-income-${Date.now()}-${Math.floor(Math.random() * 1000000)}`,
          supervisor_id: supervisorUser.id,
          supervisor_name: supervisorUser.name,
          amount: parseFloat(incomeAmount),
          date: incomeDate,
          note: incomeNote
        };
        await saveOfflineItem('offline_income', offlineItem);
        
        const mockLog = {
          id: offlineItem.id,
          supervisor_id: supervisorUser.id,
          supervisor_name: supervisorUser.name,
          amount: parseFloat(incomeAmount),
          date: incomeDate,
          note: `[Offline Pending Sync] ${incomeNote}`,
          created_at: new Date().toISOString(),
          offline_pending: true
        };
        setIncomeLogs(prev => [mockLog, ...prev]);

        triggerNotification('info', 'Saved offline! Will sync automatically when connection restores.');
        
        const [expQueue, incQueue, outflowQueue] = await Promise.all([
          getOfflineItems('offline_expenses'),
          getOfflineItems('offline_income'),
          getOfflineItems('offline_expenditures')
        ]);
        setOfflineCount(expQueue.length + incQueue.length + outflowQueue.length);

        setIncomeAmount('');
        setIncomeNote('');
      } catch (err) {
        console.error('Failed to save offline income:', err);
        triggerNotification('error', 'Could not save offline data.');
      } finally {
        setActionLoading(false);
      }
      return;
    }

    try {
      const res = await apiFetch('/api/income', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supervisor_id: supervisorUser.id,
          supervisor_name: supervisorUser.name,
          amount: parseFloat(incomeAmount),
          date: incomeDate,
          note: incomeNote
        })
      });
      if (res.ok) {
        triggerNotification('success', 'Income logged successfully!');
        setIncomeAmount('');
        setIncomeNote('');
        fetchSupervisorCashBookData(supervisorUser.id);
      } else {
        const errData = await res.json();
        triggerNotification('error', errData.error || 'Failed to log income.');
      }
    } catch (err) {
      console.warn('Network request failed, falling back to offline saving for income:', err);
      try {
        const offlineItem = {
          id: `offline-income-${Date.now()}-${Math.floor(Math.random() * 1000000)}`,
          supervisor_id: supervisorUser.id,
          supervisor_name: supervisorUser.name,
          amount: parseFloat(incomeAmount),
          date: incomeDate,
          note: incomeNote
        };
        await saveOfflineItem('offline_income', offlineItem);
        
        const mockLog = {
          id: offlineItem.id,
          supervisor_id: supervisorUser.id,
          supervisor_name: supervisorUser.name,
          amount: parseFloat(incomeAmount),
          date: incomeDate,
          note: `[Offline Pending Sync] ${incomeNote}`,
          created_at: new Date().toISOString(),
          offline_pending: true
        };
        setIncomeLogs(prev => [mockLog, ...prev]);

        triggerNotification('info', 'Network issue. Saved offline for background sync.');
        
        const [expQueue, incQueue, outflowQueue] = await Promise.all([
          getOfflineItems('offline_expenses'),
          getOfflineItems('offline_income'),
          getOfflineItems('offline_expenditures')
        ]);
        setOfflineCount(expQueue.length + incQueue.length + outflowQueue.length);

        setIncomeAmount('');
        setIncomeNote('');
      } catch (e) {
        triggerNotification('error', 'Network error. Failed to save offline.');
      }
    } finally {
      setActionLoading(false);
    }
  };

  const handleExpenditureSubmit = async (e) => {
    e.preventDefault();
    if (!expenditureAmount || !expenditureDate) {
      triggerNotification('error', 'Please enter amount and date.');
      return;
    }

    let labourer_id = null;
    let labourer_name = null;
    let to_supervisor_id = null;
    let to_supervisor_name = null;

    if (expenditureType === 'labour') {
      if (!selectedLabourerId) {
        triggerNotification('error', 'Please select a labourer.');
        return;
      }
      if (selectedLabourerId === 'other') {
        if (!otherLabourerName.trim()) {
          triggerNotification('error', 'Please enter other labourer name.');
          return;
        }
        labourer_id = null;
        labourer_name = otherLabourerName.trim();
      } else {
        const lab = labourers.find(l => l.id === selectedLabourerId);
        if (lab) {
          labourer_id = lab.id;
          labourer_name = lab.name;
        }
      }
    } else if (expenditureType === 'supervisor') {
      if (!selectedToSupervisorId) {
        triggerNotification('error', 'Please select a supervisor.');
        return;
      }
      const sup = supervisors.find(s => s.id === selectedToSupervisorId);
      if (sup) {
        to_supervisor_id = sup.id;
        to_supervisor_name = sup.name;
      }
    }

    setActionLoading(true);

    const isOffline = !navigator.onLine;
    if (isOffline) {
      try {
        const offlineItem = {
          id: `offline-exp-${Date.now()}-${Math.floor(Math.random() * 1000000)}`,
          supervisor_id: supervisorUser.id,
          supervisor_name: supervisorUser.name,
          amount: parseFloat(expenditureAmount),
          type: expenditureType,
          labourer_id,
          labourer_name,
          to_supervisor_id,
          to_supervisor_name,
          note: expenditureNote,
          date: expenditureDate
        };
        await saveOfflineItem('offline_expenditures', offlineItem);
        
        const mockLog = {
          id: offlineItem.id,
          supervisor_id: supervisorUser.id,
          supervisor_name: supervisorUser.name,
          amount: parseFloat(expenditureAmount),
          type: expenditureType,
          labourer_id,
          labourer_name,
          to_supervisor_id,
          to_supervisor_name,
          note: `[Offline Pending Sync] ${expenditureNote}`,
          date: expenditureDate,
          created_at: new Date().toISOString(),
          offline_pending: true
        };
        setExpenditureLogs(prev => [mockLog, ...prev]);

        triggerNotification('info', 'Saved offline! Will sync automatically when connection restores.');
        
        const [expQueue, incQueue, outflowQueue] = await Promise.all([
          getOfflineItems('offline_expenses'),
          getOfflineItems('offline_income'),
          getOfflineItems('offline_expenditures')
        ]);
        setOfflineCount(expQueue.length + incQueue.length + outflowQueue.length);

        setExpenditureAmount('');
        setExpenditureNote('');
        setSelectedLabourerId('');
        setOtherLabourerName('');
      } catch (err) {
        console.error('Failed to save offline expenditure:', err);
        triggerNotification('error', 'Could not save offline data.');
      } finally {
        setActionLoading(false);
      }
      return;
    }

    try {
      const res = await apiFetch('/api/expenditures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supervisor_id: supervisorUser.id,
          supervisor_name: supervisorUser.name,
          amount: parseFloat(expenditureAmount),
          type: expenditureType,
          labourer_id,
          labourer_name,
          to_supervisor_id,
          to_supervisor_name,
          note: expenditureNote,
          date: expenditureDate
        })
      });
      if (res.ok) {
        triggerNotification('success', 'Expenditure logged successfully!');
        setExpenditureAmount('');
        setExpenditureNote('');
        setSelectedLabourerId('');
        setOtherLabourerName('');
        fetchSupervisorCashBookData(supervisorUser.id);
      } else {
        const errData = await res.json();
        triggerNotification('error', errData.error || 'Failed to log expenditure.');
      }
    } catch (err) {
      console.warn('Network request failed, falling back to offline saving for expenditure:', err);
      try {
        const offlineItem = {
          id: `offline-exp-${Date.now()}-${Math.floor(Math.random() * 1000000)}`,
          supervisor_id: supervisorUser.id,
          supervisor_name: supervisorUser.name,
          amount: parseFloat(expenditureAmount),
          type: expenditureType,
          labourer_id,
          labourer_name,
          to_supervisor_id,
          to_supervisor_name,
          note: expenditureNote,
          date: expenditureDate
        };
        await saveOfflineItem('offline_expenditures', offlineItem);
        
        const mockLog = {
          id: offlineItem.id,
          supervisor_id: supervisorUser.id,
          supervisor_name: supervisorUser.name,
          amount: parseFloat(expenditureAmount),
          type: expenditureType,
          labourer_id,
          labourer_name,
          to_supervisor_id,
          to_supervisor_name,
          note: `[Offline Pending Sync] ${expenditureNote}`,
          date: expenditureDate,
          created_at: new Date().toISOString(),
          offline_pending: true
        };
        setExpenditureLogs(prev => [mockLog, ...prev]);

        triggerNotification('info', 'Network issue. Saved offline for background sync.');
        
        const [expQueue, incQueue, outflowQueue] = await Promise.all([
          getOfflineItems('offline_expenses'),
          getOfflineItems('offline_income'),
          getOfflineItems('offline_expenditures')
        ]);
        setOfflineCount(expQueue.length + incQueue.length + outflowQueue.length);

        setExpenditureAmount('');
        setExpenditureNote('');
        setSelectedLabourerId('');
        setOtherLabourerName('');
      } catch (e) {
        triggerNotification('error', 'Network error. Failed to save offline.');
      }
    } finally {
      setActionLoading(false);
    }
  };

  const handleAddLabourer = async (e) => {
    e.preventDefault();
    if (!newLabourerName.trim()) return;
    setActionLoading(true);
    try {
      const res = await apiFetch('/api/labourers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newLabourerName.trim() })
      });
      if (res.ok) {
        triggerNotification('success', 'Labourer added successfully!');
        setNewLabourerName('');
        fetchLabourers();
      } else {
        const errData = await res.json();
        triggerNotification('error', errData.error || 'Failed to add labourer.');
      }
    } catch (err) {
      triggerNotification('error', 'Connection error.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteLabourer = async (id, name) => {
    setConfirmModal({
      message: `Are you sure you want to remove ${name}?`,
      isDanger: true,
      confirmText: 'Remove',
      onConfirm: async () => {
        setConfirmModal(null);
        setActionLoading(true);
        try {
          const res = await apiFetch(`/api/labourers/${id}`, {
            method: 'DELETE'
          });
          if (res.ok) {
            triggerNotification('success', 'Labourer removed.');
            fetchLabourers();
          } else {
            triggerNotification('error', 'Failed to remove labourer.');
          }
        } catch (err) {
          triggerNotification('error', 'Connection error.');
        } finally {
          setActionLoading(false);
        }
      }
    });
  };

  // Admin add supervisor
  const handleAddSupervisor = async (e) => {
    e.preventDefault();
    if (!newSupName || !newSupPin || newSupPin.length < 4) {
      triggerNotification('error', 'Name and a 4-digit PIN are required.');
      return;
    }
    setActionLoading(true);
    try {
      const res = await apiFetch('/api/supervisors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newSupName, pin: newSupPin })
      });
      if (res.ok) {
        triggerNotification('success', `Added supervisor ${newSupName}.`);
        setNewSupName('');
        setNewSupPin('');
        fetchSupervisors();
      } else {
        const err = await res.json();
        triggerNotification('error', err.error || 'Failed to add supervisor.');
      }
    } catch (err) {
      triggerNotification('error', 'Connection error.');
    } finally {
      setActionLoading(false);
    }
  };

  // Admin edit supervisor PIN
  const handleEditSupervisorPin = async (id) => {
    if (!newSupervisorPinForEdit || newSupervisorPinForEdit.length < 4) {
      triggerNotification('error', 'A 4-digit PIN is required.');
      return;
    }
    setActionLoading(true);
    try {
      const res = await apiFetch(`/api/supervisors/${id}/pin`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: newSupervisorPinForEdit })
      });
      if (res.ok) {
        triggerNotification('success', `PIN updated successfully.`);
        setEditingSupervisorPinId(null);
        setNewSupervisorPinForEdit('');
      } else {
        const err = await res.json();
        triggerNotification('error', err.error || 'Failed to update PIN.');
      }
    } catch (err) {
      triggerNotification('error', 'Connection error.');
    } finally {
      setActionLoading(false);
    }
  };

  // Admin delete supervisor
  const handleDeleteSupervisor = async (id, name) => {
    setConfirmModal({
      message: `Permanently remove supervisor "${name}"?`,
      isDanger: true,
      confirmText: 'Remove',
      onConfirm: async () => {
        setConfirmModal(null);
        setActionLoading(true);
        try {
          const res = await apiFetch(`/api/supervisors/${id}`, {
            method: 'DELETE'
          });
          if (res.ok) {
            triggerNotification('success', `Removed supervisor.`);
            fetchSupervisors();
          } else {
            triggerNotification('error', 'Failed to remove supervisor.');
          }
        } catch (err) {
          triggerNotification('error', 'Connection error.');
        } finally {
          setActionLoading(false);
        }
      }
    });
  };

  // -------------------------------------------------------------
  // RENDERS
  // -------------------------------------------------------------

  // Pre-calculate statistics for each supervisor card (for the main Grid view)
  const supervisorsWithStats = supervisors.map(sup => {
    const supExpenses = expenses.filter(e => e.supervisor_id === sup.id || e.supervisor_name === sup.name);
    return {
      ...sup,
      pendingCount: supExpenses.filter(e => !e.verified).length,
      verifiedCount: supExpenses.filter(e => e.verified).length,
      totalAmount: supExpenses.reduce((sum, e) => sum + parseFloat(e.amount), 0)
    };
  });





  // Helper to format date from yyyy-mm-dd to dd/mm/yyyy
  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return dateStr;
  };

  // Helper to get array of months with totals and counts
  const getMonthsWithStats = (expensesList) => {
    const monthsMap = {};
    const uniqueMonths = [];
    expensesList.forEach(exp => {
      if (!exp.date) return;
      const parts = exp.date.split('-');
      if (parts.length < 2) return;
      const year = parts[0];
      const month = parts[1];
      const dateObj = new Date(parseInt(year, 10), parseInt(month, 10) - 1, 1);
      const monthName = dateObj.toLocaleString('en-US', { month: 'long', year: 'numeric' });

      if (!monthsMap[monthName]) {
        monthsMap[monthName] = {
          name: monthName,
          count: 0,
          amount: 0,
          pendingCount: 0
        };
        uniqueMonths.push(monthName);
      }

      monthsMap[monthName].count += 1;
      monthsMap[monthName].amount += parseFloat(exp.amount) || 0;
      if (!exp.verified) {
        monthsMap[monthName].pendingCount += 1;
      }
    });

    return uniqueMonths.map(name => monthsMap[name]);
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>

      {/* Global Notification Toast - Fixed absolute positioning, rendered only when triggered */}
      {notification.show && (
        <div className={`notification ${notification.type} show`}>
          <span className="notification-icon">{notification.type === 'success' ? '✓ ' : ''}</span>
          <span>{notification.message}</span>
        </div>
      )}

      {/* Global Loading Spinner */}
      {loading && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(255, 255, 255, 0.75)',
          backdropFilter: 'blur(2px)',
          zIndex: 99999,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          flexDirection: 'column',
          gap: '0.75rem'
        }}>
          <div style={{
            border: '3px solid #e2e8f0',
            borderTopColor: '#f97316',
            borderRadius: '50%',
            width: '40px',
            height: '40px',
            animation: 'spin 1s linear infinite'
          }}></div>
          <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 600 }}>Loading Portal Data...</span>
        </div>
      )}

      {/* Header */}
      <header>
        <div className="logo-section">
          <span className="logo-badge">SBT</span>
          <span className="logo-text">Site Bill Tracker</span>
        </div>
        {screen !== 'role-select' && screen !== 'supervisor-login' && screen !== 'admin-login' && (
          <button className="btn btn-secondary btn-sm" onClick={handleLogout}>
            Logout
          </button>
        )}
      </header>

      {/* 1. SCREEN: ROLE SELECT */}
      {screen === 'role-select' && (
        <div className="app-container" style={{ margin: 'auto', display: 'flex', flexDirection: 'column', gap: '1.25rem', textAlign: 'center', justifyContent: 'center' }}>
          <div style={{ padding: '0.75rem 0' }}>
            <h2 style={{ fontSize: '1.75rem', marginBottom: '0.4rem', color: 'var(--bg-charcoal)' }}>Select Profile</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Select a portal to log chits or reconcile logs.</p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <button className="btn btn-primary" style={{ padding: '1rem' }} onClick={() => setScreen('supervisor-login')}>
              I'm a Site Supervisor
            </button>

            <button className="btn btn-outline" style={{ padding: '1rem' }} onClick={() => setScreen('admin-login')}>
              I'm the Office Admin
            </button>
          </div>
        </div>
      )}

      {/* 2. SCREEN: SUPERVISOR LOGIN */}
      {screen === 'supervisor-login' && (
        <div className="app-container" style={{ margin: 'auto', maxWidth: '380px' }}>
          <div style={{ marginBottom: '1.25rem' }}>
            <button className="btn btn-outline btn-sm" onClick={() => setScreen('role-select')}>Back</button>
            <h2 style={{ marginTop: '0.75rem' }}>Supervisor Login</h2>
          </div>

          <form onSubmit={handleSupervisorLogin} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div className="form-group">
              <label className="form-label">Select Your Name</label>
              <select
                className="form-control"
                value={selectedSupId}
                onChange={(e) => setSelectedSupId(e.target.value)}
                required
              >
                <option value="" disabled>-- Select Name --</option>
                {supervisors.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Enter 4-Digit PIN</label>
              <input
                type="password"
                className="form-control mono"
                placeholder="••••"
                pattern="[0-9]*"
                inputMode="numeric"
                maxLength="4"
                value={supPin}
                onChange={(e) => setSupPin(e.target.value)}
                required
              />
            </div>

            <button type="submit" className="btn btn-primary" disabled={actionLoading}>
              {actionLoading ? 'Verifying...' : 'Unlock Portal'}
            </button>
          </form>
        </div>
      )}

      {/* 3. SCREEN: ADMIN SETUP OR LOGIN */}
      {screen === 'admin-login' && (
        <div className="app-container" style={{ margin: 'auto', maxWidth: '380px' }}>
          <div style={{ marginBottom: '1.25rem' }}>
            <button className="btn btn-outline btn-sm" onClick={() => setScreen('role-select')}>Back</button>
            <h2 style={{ marginTop: '0.75rem' }}>Admin Access</h2>
          </div>

          {!adminExists ? (
            // SETUP ADMIN PIN
            <form onSubmit={handleAdminSetup} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <p style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                No Admin PIN configured yet. Set one now to initialize the system.
              </p>

              <div className="form-group">
                <label className="form-label">Set Admin PIN (min 4 digits)</label>
                <input
                  type="password"
                  className="form-control mono"
                  placeholder="••••"
                  pattern="[0-9]*"
                  inputMode="numeric"
                  value={adminPin}
                  onChange={(e) => setAdminPin(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Confirm Admin PIN</label>
                <input
                  type="password"
                  className="form-control mono"
                  placeholder="••••"
                  pattern="[0-9]*"
                  inputMode="numeric"
                  value={confirmAdminPin}
                  onChange={(e) => setConfirmAdminPin(e.target.value)}
                  required
                />
              </div>

              <button type="submit" className="btn btn-primary" disabled={actionLoading}>
                {actionLoading ? 'Setting PIN...' : 'Save & Initialize'}
              </button>
            </form>
          ) : (
            // LOGIN ADMIN
            <form onSubmit={handleAdminLogin} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div className="form-group">
                <label className="form-label">Enter Admin Security PIN</label>
                <input
                  type="password"
                  className="form-control mono"
                  placeholder="••••"
                  pattern="[0-9]*"
                  inputMode="numeric"
                  value={adminPin}
                  onChange={(e) => setAdminPin(e.target.value)}
                  required
                />
              </div>

              <button type="submit" className="btn btn-primary" disabled={actionLoading}>
                {actionLoading ? 'Verifying...' : 'Unlock Dashboard'}
              </button>
            </form>
          )}
        </div>
      )}

      {/* 4. SCREEN: SUPERVISOR PORTAL DASHBOARD */}
      {screen === 'supervisor-dashboard' && supervisorUser && (
        <div className="app-container">

          {selectedSupervisorExpenditureMonth ? (
            deletingLog ? (
              /* Confirmation Page */
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                {/* Header */}
                <div>
                  <h2 style={{ fontSize: '1.5rem', margin: '0.25rem 0 0 0', color: 'var(--color-danger)' }}>
                    Confirm Deletion
                  </h2>
                  <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: 0 }}>
                    Please review the transaction details below before deleting.
                  </p>
                </div>

                {/* Complete Row Details Card */}
                <div className="card" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                  <h3 style={{ fontSize: '13px', margin: 0, borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem', textTransform: 'uppercase' }}>
                    Payout Outflow Log Details
                  </h3>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', fontSize: '14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Date:</span>
                      <strong className="mono">{formatDate(deletingLog.date)}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Payout Type:</span>
                      <strong>{deletingLog.type === 'labour' ? 'Daily Labourer' : 'General Site Expense'}</strong>
                    </div>
                    {deletingLog.type === 'labour' && (
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Labourer:</span>
                        <strong>{deletingLog.labourer_name}</strong>
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Amount Paid:</span>
                      <strong style={{ color: 'var(--color-danger)' }}>₹{parseFloat(deletingLog.amount).toFixed(2)}</strong>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Description / Remarks:</span>
                      <div style={{ background: 'var(--bg-paper)', padding: '0.5rem', borderRadius: '4px', fontStyle: deletingLog.note ? 'normal' : 'italic', fontSize: '13px' }}>
                        {deletingLog.note || 'No remarks provided'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Verification Status:</span>
                      <span className="badge-pending" style={{ fontSize: '11px' }}>Pending</span>
                    </div>
                  </div>
                </div>

                {/* Confirmation Box */}
                <div className="card" style={{ border: '1.5px solid var(--color-danger)', backgroundColor: '#fff5f5', padding: '0.8rem', textAlign: 'center' }}>
                  <p style={{ color: 'var(--color-danger)', fontWeight: 'bold', fontSize: '14px', margin: 0 }}>
                    Are you sure you want to permanently delete this cash payout record?
                  </p>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0.25rem 0 0 0' }}>
                    This action cannot be undone.
                  </p>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                  <button
                    className="btn btn-danger"
                    onClick={() => handleDeleteExpenditure(deletingLog.id)}
                    disabled={actionLoading}
                    style={{ padding: '0.8rem' }}
                  >
                    {actionLoading ? 'Deleting...' : 'Yes, Confirm Delete'}
                  </button>
                  <button
                    className="btn btn-outline"
                    onClick={() => setDeletingLog(null)}
                    disabled={actionLoading}
                    style={{ padding: '0.8rem' }}
                  >
                    No, Cancel
                  </button>
                </div>
              </div>
            ) : (
              /* Month Outflow Details page */
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {/* Back to Dashboard Navigation */}
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={() => {
                      setSelectedSupervisorExpenditureMonth(null);
                      setSupExpFilterLabourerId('all');
                      setSupExpFilterStatus('all');
                      setSupExpFilterDate('');
                      setIsDeleteMode(false);
                      setDeletingLog(null);
                    }}
                    style={{ width: 'auto', display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.4rem 0.6rem' }}
                  >
                    ← Back to Dashboard
                  </button>
                </div>

                {/* Title & Delete Mode Toggle */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h2 style={{ fontSize: '1.5rem', margin: '0.25rem 0 0 0', color: 'var(--bg-charcoal)' }}>
                      {selectedSupervisorExpenditureMonth} Outflow
                    </h2>
                    <span className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      Supervisor: <strong>{supervisorUser.name}</strong>
                    </span>
                  </div>
                  <button
                    className={`btn btn-sm ${isDeleteMode ? 'btn-primary' : 'btn-outline'}`}
                    onClick={() => setIsDeleteMode(!isDeleteMode)}
                    style={{
                      width: 'auto',
                      padding: '0.4rem 0.6rem',
                      fontSize: '12px',
                      backgroundColor: isDeleteMode ? 'var(--color-danger)' : 'transparent',
                      borderColor: isDeleteMode ? 'var(--color-danger)' : 'var(--bg-charcoal)',
                      color: isDeleteMode ? '#fff' : 'var(--bg-charcoal)'
                    }}
                  >
                    {isDeleteMode ? 'Exit Delete' : 'Delete Logs'}
                  </button>
                </div>

                {/* Stats Summary Panel */}
                {(() => {
                  const monthLogs = expenditureLogs.filter(log => {
                    if (!log.date) return false;
                    const parts = log.date.split('-');
                    if (parts.length < 2) return false;
                    const dateObj = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, 1);
                    const mName = dateObj.toLocaleString('default', { month: 'long', year: 'numeric' });
                    return mName === selectedSupervisorExpenditureMonth;
                  });

                  const totalAmount = monthLogs.reduce((sum, log) => sum + (parseFloat(log.amount) || 0), 0);
                  const verifiedAmount = monthLogs.filter(log => log.verified).reduce((sum, log) => sum + (parseFloat(log.amount) || 0), 0);
                  const pendingAmount = monthLogs.filter(log => !log.verified).reduce((sum, log) => sum + (parseFloat(log.amount) || 0), 0);

                  return (
                    <div className="card" style={{ display: 'flex', justifyContent: 'space-around', padding: '0.6rem 0.4rem', backgroundColor: 'var(--bg-charcoal)', color: 'var(--text-light)', border: 'none' }}>
                      <div style={{ textAlign: 'center', flex: 1 }}>
                        <div style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Total Outflow</div>
                        <div style={{ fontSize: '15px', fontWeight: 'bold', color: 'var(--color-orange)' }}>₹{totalAmount.toFixed(2)}</div>
                      </div>
                      <div style={{ borderLeft: '1px solid #444', height: '30px', alignSelf: 'center' }}></div>
                      <div style={{ textAlign: 'center', flex: 1 }}>
                        <div style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Verified</div>
                        <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#51cf66' }}>₹{verifiedAmount.toFixed(2)}</div>
                      </div>
                      <div style={{ borderLeft: '1px solid #444', height: '30px', alignSelf: 'center' }}></div>
                      <div style={{ textAlign: 'center', flex: 1 }}>
                        <div style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Pending</div>
                        <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#ff922b' }}>₹{pendingAmount.toFixed(2)}</div>
                      </div>
                    </div>
                  );
                })()}

                {/* Filters Card */}
                <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '0.75rem' }}>
                  <h4 style={{ fontSize: '12px', margin: 0, color: 'var(--bg-charcoal)' }}>Filters & Search</h4>

                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <div className="form-group" style={{ flex: 1, minWidth: 0, marginBottom: 0 }}>
                      <label className="form-label" style={{ fontSize: '10px' }}>Filter by Labourer</label>
                      <select
                        className="form-control"
                        value={supExpFilterLabourerId}
                        onChange={(e) => setSupExpFilterLabourerId(e.target.value)}
                        style={{ fontSize: '13px', padding: '0.4rem' }}
                      >
                        <option value="all">All Outflows</option>
                        <option value="general">General Site Expenses</option>
                        <option value="supervisor">Payments to Supervisors</option>
                        <optgroup label="Daily Labourers">
                          {labourers.map(l => (
                            <option key={l.id} value={l.id}>{l.name}</option>
                          ))}
                        </optgroup>
                      </select>
                    </div>

                    <div className="form-group" style={{ flex: 1, minWidth: 0, marginBottom: 0 }}>
                      <label className="form-label" style={{ fontSize: '10px' }}>Filter Status</label>
                      <select
                        className="form-control"
                        value={supExpFilterStatus}
                        onChange={(e) => setSupExpFilterStatus(e.target.value)}
                        style={{ fontSize: '13px', padding: '0.4rem' }}
                      >
                        <option value="all">All Statuses</option>
                        <option value="pending">Pending Only</option>
                        <option value="verified">Verified Only</option>
                      </select>
                    </div>
                  </div>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: '10px' }}>Filter by Date</label>
                    <input
                      type="date"
                      className="form-control"
                      value={supExpFilterDate}
                      onChange={(e) => setSupExpFilterDate(e.target.value)}
                      style={{ fontSize: '13px', padding: '0.4rem' }}
                    />
                  </div>

                  {(supExpFilterLabourerId !== 'all' || supExpFilterStatus !== 'all' || supExpFilterDate !== '') && (
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={() => {
                        setSupExpFilterLabourerId('all');
                        setSupExpFilterStatus('all');
                        setSupExpFilterDate('');
                      }}
                      style={{ alignSelf: 'flex-start', padding: '0.2rem 0.5rem', fontSize: '11px', textTransform: 'none', width: 'auto', marginTop: '0.25rem' }}
                    >
                      Clear Filters
                    </button>
                  )}
                </div>

                {/* Table Card */}
                <div className="card card-table-container">
                  {(() => {
                    const filteredLogs = expenditureLogs
                      .filter(log => {
                        if (!log.date) return false;
                        const parts = log.date.split('-');
                        if (parts.length < 2) return false;
                        const dateObj = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, 1);
                        const mName = dateObj.toLocaleString('default', { month: 'long', year: 'numeric' });
                        return mName === selectedSupervisorExpenditureMonth;
                      })
                      .filter(log => {
                        const matchesLabourer =
                          supExpFilterLabourerId === 'all' ||
                          (supExpFilterLabourerId === 'general' && log.type === 'general') ||
                          (supExpFilterLabourerId === 'supervisor' && log.type === 'supervisor') ||
                          (supExpFilterLabourerId !== 'general' && supExpFilterLabourerId !== 'supervisor' && log.type === 'labour' && log.labourer_id === supExpFilterLabourerId);

                        const matchesStatus =
                          supExpFilterStatus === 'all' ||
                          (supExpFilterStatus === 'verified' && log.verified) ||
                          (supExpFilterStatus === 'pending' && !log.verified);

                        const matchesDate =
                          !supExpFilterDate ||
                          log.date === supExpFilterDate;

                        return matchesLabourer && matchesStatus && matchesDate;
                      });

                    if (filteredLogs.length === 0) {
                      return (
                        <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
                          <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '0.5rem' }}>No payout records match the active filters.</p>
                          {(supExpFilterLabourerId !== 'all' || supExpFilterStatus !== 'all' || supExpFilterDate !== '') && (
                            <button
                              className="btn btn-outline btn-sm"
                              onClick={() => {
                                setSupExpFilterLabourerId('all');
                                setSupExpFilterStatus('all');
                                setSupExpFilterDate('');
                              }}
                              style={{ width: 'auto', display: 'inline-flex', padding: '0.2rem 0.5rem', fontSize: '11px', textTransform: 'none' }}
                            >
                              Clear Filters
                            </button>
                          )}
                        </div>
                      );
                    }

                    return (
                      <table className="ledger-table exp-table">
                        <thead>
                          <tr>
                            <th className="col-date">DATE</th>
                            <th className="col-desc">ITEM</th>
                            <th className="col-amount">AMOUNT</th>
                            <th className="col-status">{isDeleteMode ? 'DELETE' : 'VERIFY'}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredLogs.map(log => (
                            <tr key={log.id}>
                              <td style={{ whiteSpace: 'nowrap' }}>{formatDate(log.date)}</td>
                              <td>
                                {log.type === 'labour' ? (
                                  <span><strong>Labour:</strong> {log.labourer_name} {log.note && ` (${log.note})`}</span>
                                ) : log.type === 'supervisor' ? (
                                  <span><strong>To Supervisor:</strong> {log.to_supervisor_name} {log.note && ` (${log.note})`}</span>
                                ) : (
                                  <span><strong>General:</strong> {log.note || 'Site expense'}</span>
                                )}
                              </td>
                              <td style={{ textAlign: 'right', fontWeight: 'bold', color: 'var(--color-danger)', whiteSpace: 'nowrap' }}>
                                ₹{parseFloat(log.amount).toFixed(2)}
                              </td>
                              <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                                {isDeleteMode ? (
                                  log.verified ? (
                                    <span className="badge-verified" style={{ fontSize: '11px', opacity: 0.6 }}>Verified</span>
                                  ) : (
                                    <button
                                      className="btn btn-danger btn-sm"
                                      onClick={() => setDeletingLog(log)}
                                      style={{ padding: '0.15rem 0.4rem', fontSize: '11px', textTransform: 'none', width: 'auto' }}
                                    >
                                      Delete
                                    </button>
                                  )
                                ) : (
                                  <span className={log.verified ? "badge-verified" : "badge-pending"} style={{ fontSize: '11px' }}>
                                    {log.verified ? 'Verified' : 'Pending'}
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    );
                  })()}
                </div>
              </div>
            )
          ) : selectedSupervisorIncomeMonth ? (
            deletingIncLog ? (
              /* Income Delete Confirmation Page */
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <div>
                  <h2 style={{ fontSize: '1.5rem', margin: '0.25rem 0 0 0', color: 'var(--color-danger)' }}>
                    Confirm Deletion
                  </h2>
                  <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: 0 }}>
                    Please review the transaction details below before deleting.
                  </p>
                </div>

                <div className="card" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                  <h3 style={{ fontSize: '13px', margin: 0, borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem', textTransform: 'uppercase' }}>
                    Cash Income Record Details
                  </h3>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', fontSize: '14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Date Received:</span>
                      <strong className="mono">{formatDate(deletingIncLog.date)}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Amount Received:</span>
                      <strong style={{ color: 'var(--color-success)' }}>₹{parseFloat(deletingIncLog.amount).toFixed(2)}</strong>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Remarks / Sources:</span>
                      <div style={{ background: 'var(--bg-paper)', padding: '0.5rem', borderRadius: '4px', fontStyle: deletingIncLog.note ? 'normal' : 'italic', fontSize: '13px' }}>
                        {deletingIncLog.note || 'Office Admin'}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="card" style={{ border: '1.5px solid var(--color-danger)', backgroundColor: '#fff5f5', padding: '0.8rem', textAlign: 'center' }}>
                  <p style={{ color: 'var(--color-danger)', fontWeight: 'bold', fontSize: '14px', margin: 0 }}>
                    Are you sure you want to permanently delete this cash received record?
                  </p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                  <button
                    className="btn btn-danger"
                    onClick={() => handleDeleteIncome(deletingIncLog.id)}
                    disabled={actionLoading}
                    style={{ padding: '0.8rem' }}
                  >
                    {actionLoading ? 'Deleting...' : 'Yes, Confirm Delete'}
                  </button>
                  <button
                    className="btn btn-outline"
                    onClick={() => setDeletingIncLog(null)}
                    disabled={actionLoading}
                    style={{ padding: '0.8rem' }}
                  >
                    No, Cancel
                  </button>
                </div>
              </div>
            ) : (
              /* Income Month Page details */
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={() => {
                      setSelectedSupervisorIncomeMonth(null);
                      setSupIncFilterSearch('');
                      setIsIncDeleteMode(false);
                      setDeletingIncLog(null);
                    }}
                    style={{ width: 'auto', display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.4rem 0.6rem' }}
                  >
                    ← Back to Dashboard
                  </button>
                </div>

                {/* Title & Delete Mode Toggle */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div>
                    <h2 style={{ fontSize: '1.5rem', margin: '0.25rem 0 0 0', color: 'var(--bg-charcoal)' }}>
                      {selectedSupervisorIncomeMonth} Inflow
                    </h2>
                    <span className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      Supervisor: <strong>{supervisorUser.name}</strong>
                    </span>
                  </div>
                  <button
                    className={`btn btn-sm ${isIncDeleteMode ? 'btn-primary' : 'btn-outline'}`}
                    onClick={() => setIsIncDeleteMode(!isIncDeleteMode)}
                    style={{
                      width: 'auto',
                      padding: '0.4rem 0.6rem',
                      fontSize: '12px',
                      backgroundColor: isIncDeleteMode ? 'var(--color-danger)' : 'transparent',
                      borderColor: isIncDeleteMode ? 'var(--color-danger)' : 'var(--bg-charcoal)',
                      color: isIncDeleteMode ? '#fff' : 'var(--bg-charcoal)'
                    }}
                  >
                    {isIncDeleteMode ? 'Exit Delete' : 'Delete Logs'}
                  </button>
                </div>

                {/* Stats Summary Panel */}
                {(() => {
                  const monthLogs = incomeLogs.filter(log => {
                    if (!log.date) return false;
                    const parts = log.date.split('-');
                    if (parts.length < 2) return false;
                    const dateObj = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, 1);
                    const mName = dateObj.toLocaleString('default', { month: 'long', year: 'numeric' });
                    return mName === selectedSupervisorIncomeMonth;
                  });

                  const totalAmount = monthLogs.reduce((sum, log) => sum + (parseFloat(log.amount) || 0), 0);

                  return (
                    <div className="card" style={{ display: 'flex', justifyContent: 'center', padding: '0.6rem 0.4rem', backgroundColor: 'var(--bg-charcoal)', color: 'var(--text-light)', border: 'none' }}>
                      <div style={{ textAlign: 'center', flex: 1 }}>
                        <div style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Total Cash Inflow</div>
                        <div style={{ fontSize: '15px', fontWeight: 'bold', color: 'var(--color-orange)' }}>₹{totalAmount.toFixed(2)}</div>
                      </div>
                    </div>
                  );
                })()}

                {/* Filters Card */}
                <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '0.75rem' }}>
                  <h4 style={{ fontSize: '12px', margin: 0, color: 'var(--bg-charcoal)' }}>Filters & Search</h4>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: '10px' }}>Search Remarks / Amount</label>
                    <input
                      type="text"
                      className="form-control"
                      placeholder="Search remarks, amount, date..."
                      value={supIncFilterSearch}
                      onChange={(e) => setSupIncFilterSearch(e.target.value)}
                      style={{ fontSize: '13px', padding: '0.4rem' }}
                    />
                  </div>

                  {supIncFilterSearch !== '' && (
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={() => setSupIncFilterSearch('')}
                      style={{ alignSelf: 'flex-start', padding: '0.2rem 0.5rem', fontSize: '11px', textTransform: 'none', width: 'auto', marginTop: '0.25rem' }}
                    >
                      Clear Filters
                    </button>
                  )}
                </div>

                {/* Table Card */}
                <div className="card card-table-container">
                  {(() => {
                    const filteredLogs = incomeLogs
                      .filter(log => {
                        if (!log.date) return false;
                        const parts = log.date.split('-');
                        if (parts.length < 2) return false;
                        const dateObj = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, 1);
                        const mName = dateObj.toLocaleString('default', { month: 'long', year: 'numeric' });
                        return mName === selectedSupervisorIncomeMonth;
                      })
                      .filter(log => {
                        const matchesSearch =
                          !supIncFilterSearch ||
                          (log.note && log.note.toLowerCase().includes(supIncFilterSearch.toLowerCase())) ||
                          (log.amount && log.amount.toString().includes(supIncFilterSearch)) ||
                          (log.date && formatDate(log.date).toLowerCase().includes(supIncFilterSearch.toLowerCase()));

                        return matchesSearch;
                      });

                    if (filteredLogs.length === 0) {
                      return (
                        <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
                          <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '0.5rem' }}>No cash records match the active filters.</p>
                          {supIncFilterSearch !== '' && (
                            <button
                              className="btn btn-outline btn-sm"
                              onClick={() => setSupIncFilterSearch('')}
                              style={{ width: 'auto', display: 'inline-flex', padding: '0.2rem 0.5rem', fontSize: '11px', textTransform: 'none' }}
                            >
                              Clear Filters
                            </button>
                          )}
                        </div>
                      );
                    }

                    return (
                      <table className="ledger-table inc-table">
                        <thead>
                          <tr>
                            <th className="col-date">DATE</th>
                            <th className="col-desc">FROM</th>
                            <th className="col-amount">AMOUNT</th>
                            {isIncDeleteMode && <th className="col-status">DELETE</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {filteredLogs.map(log => (
                            <tr key={log.id}>
                              <td style={{ whiteSpace: 'nowrap' }}>{formatDate(log.date)}</td>
                              <td>{log.note || 'Office Admin'}</td>
                              <td style={{ textAlign: 'right', fontWeight: 'bold', color: 'var(--color-success)', whiteSpace: 'nowrap' }}>
                                ₹{parseFloat(log.amount).toFixed(2)}
                              </td>
                              {isIncDeleteMode && (
                                <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                                  <button
                                    className="btn btn-danger btn-sm"
                                    onClick={() => setDeletingIncLog(log)}
                                    style={{ padding: '0.15rem 0.4rem', fontSize: '11px', textTransform: 'none', width: 'auto' }}
                                  >
                                    Delete
                                  </button>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    );
                  })()}
                </div>
              </div>
            )
          ) : selectedSupervisorMonth ? (
            deletingBillLog ? (
              /* Bill Delete Confirmation Page */
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <div>
                  <h2 style={{ fontSize: '1.5rem', margin: '0.25rem 0 0 0', color: 'var(--color-danger)' }}>
                    Confirm Deletion
                  </h2>
                  <p style={{ color: 'var(--text-muted)', fontSize: '13px', margin: 0 }}>
                    Please review the bill details below before deleting.
                  </p>
                </div>

                <div className="card" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                  <h3 style={{ fontSize: '13px', margin: 0, borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem', textTransform: 'uppercase' }}>
                    Bill Chit Record Details
                  </h3>

                  {deletingBillLog.photo_url && (
                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                      <img
                        src={deletingBillLog.photo_url}
                        alt="Receipt Chit Preview"
                        style={{ maxHeight: '180px', objectFit: 'contain', border: '1px solid var(--border-color)', borderRadius: '4px' }}
                      />
                    </div>
                  )}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', fontSize: '14px', marginTop: '0.4rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Date Logged:</span>
                      <strong className="mono">{formatDate(deletingBillLog.date)}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Amount Paid:</span>
                      <strong style={{ color: 'var(--color-danger)' }}>₹{parseFloat(deletingBillLog.amount).toFixed(2)}</strong>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Note / Remarks:</span>
                      <div style={{ background: 'var(--bg-paper)', padding: '0.5rem', borderRadius: '4px', fontStyle: deletingBillLog.note ? 'normal' : 'italic', fontSize: '13px' }}>
                        {deletingBillLog.note || 'No description provided'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Verification Status:</span>
                      <span className="badge-pending" style={{ fontSize: '11px' }}>Pending</span>
                    </div>
                  </div>
                </div>

                <div className="card" style={{ border: '1.5px solid var(--color-danger)', backgroundColor: '#fff5f5', padding: '0.8rem', textAlign: 'center' }}>
                  <p style={{ color: 'var(--color-danger)', fontWeight: 'bold', fontSize: '14px', margin: 0 }}>
                    Are you sure you want to permanently delete this receipt bill chit?
                  </p>
                  <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0.25rem 0 0 0' }}>
                    The uploaded image file will also be deleted from storage.
                  </p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                  <button
                    className="btn btn-danger"
                    onClick={() => handleDeleteBill(deletingBillLog.id)}
                    disabled={actionLoading}
                    style={{ padding: '0.8rem' }}
                  >
                    {actionLoading ? 'Deleting...' : 'Yes, Confirm Delete'}
                  </button>
                  <button
                    className="btn btn-outline"
                    onClick={() => setDeletingBillLog(null)}
                    disabled={actionLoading}
                    style={{ padding: '0.8rem' }}
                  >
                    No, Cancel
                  </button>
                </div>
              </div>
            ) : (
              /* Bills Month Page details */
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={() => {
                      setSelectedSupervisorMonth(null);
                      setSupBillFilterStatus('all');
                      setSupBillFilterSearch('');
                      setIsBillDeleteMode(false);
                      setDeletingBillLog(null);
                    }}
                    style={{ width: 'auto', display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.4rem 0.6rem' }}
                  >
                    ← Back to Dashboard
                  </button>
                </div>

                {/* Title & Delete Mode Toggle */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <h2 style={{ fontSize: '1.5rem', margin: '0.25rem 0 0 0', color: 'var(--bg-charcoal)' }}>
                      {selectedSupervisorMonth} Bills
                    </h2>
                    <span className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      Supervisor: <strong>{supervisorUser.name}</strong>
                    </span>
                  </div>
                  <button
                    className={`btn btn-sm ${isBillDeleteMode ? 'btn-primary' : 'btn-outline'}`}
                    onClick={() => setIsBillDeleteMode(!isBillDeleteMode)}
                    style={{
                      width: 'auto',
                      padding: '0.4rem 0.6rem',
                      fontSize: '12px',
                      backgroundColor: isBillDeleteMode ? 'var(--color-danger)' : 'transparent',
                      borderColor: isBillDeleteMode ? 'var(--color-danger)' : 'var(--bg-charcoal)',
                      color: isBillDeleteMode ? '#fff' : 'var(--bg-charcoal)'
                    }}
                  >
                    {isBillDeleteMode ? 'Exit Delete' : 'Delete Logs'}
                  </button>
                </div>

                {/* Stats Summary Panel */}
                {(() => {
                  const monthLogs = myRecentBills.filter(bill => {
                    if (!bill.date) return false;
                    const parts = bill.date.split('-');
                    if (parts.length < 2) return false;
                    const dateObj = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, 1);
                    const mName = dateObj.toLocaleString('default', { month: 'long', year: 'numeric' });
                    return mName === selectedSupervisorMonth;
                  });

                  const totalAmount = monthLogs.reduce((sum, bill) => sum + (parseFloat(bill.amount) || 0), 0);
                  const verifiedAmount = monthLogs.filter(bill => bill.verified).reduce((sum, bill) => sum + (parseFloat(bill.amount) || 0), 0);
                  const pendingAmount = monthLogs.filter(bill => !bill.verified).reduce((sum, bill) => sum + (parseFloat(bill.amount) || 0), 0);

                  return (
                    <div className="card" style={{ display: 'flex', justifyContent: 'space-around', padding: '0.6rem 0.4rem', backgroundColor: 'var(--bg-charcoal)', color: 'var(--text-light)', border: 'none' }}>
                      <div style={{ textAlign: 'center', flex: 1 }}>
                        <div style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Total Amount</div>
                        <div style={{ fontSize: '15px', fontWeight: 'bold', color: 'var(--color-orange)' }}>₹{totalAmount.toFixed(2)}</div>
                      </div>
                      <div style={{ borderLeft: '1px solid #444', height: '30px', alignSelf: 'center' }}></div>
                      <div style={{ textAlign: 'center', flex: 1 }}>
                        <div style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Verified</div>
                        <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#51cf66' }}>₹{verifiedAmount.toFixed(2)}</div>
                      </div>
                      <div style={{ borderLeft: '1px solid #444', height: '30px', alignSelf: 'center' }}></div>
                      <div style={{ textAlign: 'center', flex: 1 }}>
                        <div style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Pending</div>
                        <div style={{ fontSize: '15px', fontWeight: 'bold', color: '#ff922b' }}>₹{pendingAmount.toFixed(2)}</div>
                      </div>
                    </div>
                  );
                })()}

                {/* Filters Card */}
                <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '0.75rem' }}>
                  <h4 style={{ fontSize: '12px', margin: 0, color: 'var(--bg-charcoal)' }}>Filters & Search</h4>

                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <div className="form-group" style={{ flex: 1, minWidth: 0, marginBottom: 0 }}>
                      <label className="form-label" style={{ fontSize: '10px' }}>Filter Status</label>
                      <select
                        className="form-control"
                        value={supBillFilterStatus}
                        onChange={(e) => setSupBillFilterStatus(e.target.value)}
                        style={{ fontSize: '13px', padding: '0.4rem' }}
                      >
                        <option value="all">All Statuses</option>
                        <option value="pending">Pending Only</option>
                        <option value="verified">Verified Only</option>
                      </select>
                    </div>

                    <div className="form-group" style={{ flex: 1, minWidth: 0, marginBottom: 0 }}>
                      <label className="form-label" style={{ fontSize: '10px' }}>Search Notes / Amount</label>
                      <input
                        type="text"
                        className="form-control"
                        placeholder="Search notes, amount, date..."
                        value={supBillFilterSearch}
                        onChange={(e) => setSupBillFilterSearch(e.target.value)}
                        style={{ fontSize: '13px', padding: '0.4rem' }}
                      />
                    </div>
                  </div>

                  {(supBillFilterStatus !== 'all' || supBillFilterSearch !== '') && (
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={() => {
                        setSupBillFilterStatus('all');
                        setSupBillFilterSearch('');
                      }}
                      style={{ alignSelf: 'flex-start', padding: '0.2rem 0.5rem', fontSize: '11px', textTransform: 'none', width: 'auto', marginTop: '0.25rem' }}
                    >
                      Clear Filters
                    </button>
                  )}
                </div>

                {/* Table Card */}
                <div className="card card-table-container">
                  {(() => {
                    const filteredLogs = myRecentBills
                      .filter(bill => {
                        if (!bill.date) return false;
                        const parts = bill.date.split('-');
                        if (parts.length < 2) return false;
                        const dateObj = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, 1);
                        const mName = dateObj.toLocaleString('default', { month: 'long', year: 'numeric' });
                        return mName === selectedSupervisorMonth;
                      })
                      .filter(bill => {
                        const matchesStatus =
                          supBillFilterStatus === 'all' ||
                          (supBillFilterStatus === 'verified' && bill.verified) ||
                          (supBillFilterStatus === 'pending' && !bill.verified);

                        const matchesSearch =
                          !supBillFilterSearch ||
                          (bill.note && bill.note.toLowerCase().includes(supBillFilterSearch.toLowerCase())) ||
                          (bill.amount && bill.amount.toString().includes(supBillFilterSearch)) ||
                          (bill.date && formatDate(bill.date).toLowerCase().includes(supBillFilterSearch.toLowerCase()));

                        return matchesStatus && matchesSearch;
                      });

                    if (filteredLogs.length === 0) {
                      return (
                        <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
                          <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '0.5rem' }}>No bills match the active filters.</p>
                          {(supBillFilterStatus !== 'all' || supBillFilterSearch !== '') && (
                            <button
                              className="btn btn-outline btn-sm"
                              onClick={() => {
                                setSupBillFilterStatus('all');
                                setSupBillFilterSearch('');
                              }}
                              style={{ width: 'auto', display: 'inline-flex', padding: '0.2rem 0.5rem', fontSize: '11px', textTransform: 'none' }}
                            >
                              Clear Filters
                            </button>
                          )}
                        </div>
                      );
                    }

                    return (
                      <table className="ledger-table bills-table">
                        <thead>
                          <tr>
                            <th className="col-date">DATE</th>
                            <th className="col-desc">ITEM</th>
                            <th className="col-amount">AMOUNT</th>
                            <th className="col-status">{isBillDeleteMode ? 'DELETE' : 'VERIFY'}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredLogs.map(bill => (
                            <tr key={bill.id}>
                              <td style={{ whiteSpace: 'nowrap' }}>{formatDate(bill.date)}</td>
                              <td style={{ verticalAlign: 'middle' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.4rem' }}>
                                  <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>{bill.note || 'No description'}</span>
                                  {bill.photo_url && (
                                    <img
                                      src={bill.photo_url}
                                      alt="Receipt Chit"
                                      onClick={() => setSelectedPhoto(bill.photo_url)}
                                      className="ledger-bill-thumb"
                                      style={{ flexShrink: 0 }}
                                    />
                                  )}
                                </div>
                              </td>
                              <td style={{ textAlign: 'right', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                                ₹{parseFloat(bill.amount).toFixed(2)}
                              </td>
                              <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                                {isBillDeleteMode ? (
                                  bill.verified ? (
                                    <span className="badge-verified" style={{ fontSize: '11px', opacity: 0.6 }}>Verified</span>
                                  ) : (
                                    <button
                                      className="btn btn-danger btn-sm"
                                      onClick={() => setDeletingBillLog(bill)}
                                      style={{ padding: '0.15rem 0.4rem', fontSize: '11px', textTransform: 'none', width: 'auto' }}
                                    >
                                      Delete
                                    </button>
                                  )
                                ) : (
                                  <span className={bill.verified ? "badge-verified" : "badge-pending"} style={{ fontSize: '11px' }}>
                                    {bill.verified ? 'Verified' : 'Pending'}
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    );
                  })()}
                </div>
              </div>
            )
          ) : (
            <>
              {/* Supervisor Identity Header */}
              <div className="site-project-header">
                <h2 className="project-title" style={{ textTransform: 'capitalize' }}>
                  Hi {supervisorUser.name}
                </h2>
              </div>

              {/* Summary Current Month Card */}
              {(() => {
                const { monthlyReports, currentInHandBalance } = getSupervisorMonthlySettlements(supervisorUser.id);
                const currentReport = monthlyReports.length > 0 ? monthlyReports[monthlyReports.length - 1] : null;
                const displayMonthName = currentReport ? currentReport.month : new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });
                const inflow = currentReport ? currentReport.inflow : 0;
                const outflowExp = currentReport ? currentReport.outflowExpenditures : 0;
                const outflowBills = currentReport ? currentReport.outflowBills : 0;
                const inHand = currentReport ? currentReport.cashLeft : currentInHandBalance;
                const openingBal = currentReport ? currentReport.openingBalance : 0;

                return (
                  <div className="current-month-summary-card">
                    <div className="summary-card-header">
                      <div className="summary-card-title">
                        <span className="month-badge-dot"></span>
                        <span>{displayMonthName} Summary</span>
                      </div>
                      <div className="summary-opening-tag">
                        Opening Bal: ₹{openingBal.toFixed(2)}
                      </div>
                    </div>

                    <div className="summary-grid-2x2">
                      <div className="summary-stat-box">
                        <span className="stat-label">Cash Received (Inflow)</span>
                        <span className="stat-value text-success">₹{inflow.toFixed(2)}</span>
                      </div>
                      <div className="summary-stat-box">
                        <span className="stat-label">Outflows (Payouts)</span>
                        <span className="stat-value text-danger">₹{outflowExp.toFixed(2)}</span>
                      </div>
                      <div className="summary-stat-box">
                        <span className="stat-label">Bills (Receipts)</span>
                        <span className="stat-value text-danger">₹{outflowBills.toFixed(2)}</span>
                      </div>
                      <div className="summary-stat-box summary-stat-inhand">
                        <span className="stat-label">In Hand Balance</span>
                        <span className="stat-value text-dark">₹{inHand.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Segmented Sub-Tab Navigation Bar */}
              <div className="segmented-nav">
                <button
                  className={`segmented-nav-btn ${supervisorTab === 'income' ? 'active' : ''}`}
                  onClick={() => {
                    setSupervisorTab('income');
                    setSelectedSupervisorIncomeMonth(null);
                    setIsDeleteMode(false);
                    setDeletingLog(null);
                    setIsIncDeleteMode(false);
                    setDeletingIncLog(null);
                    setIsBillDeleteMode(false);
                    setDeletingBillLog(null);
                  }}
                >
                  Income
                </button>
                <button
                  className={`segmented-nav-btn ${supervisorTab === 'expenditure' ? 'active' : ''}`}
                  onClick={() => {
                    setSupervisorTab('expenditure');
                    setSelectedSupervisorExpenditureMonth(null);
                    setSupExpFilterLabourerId('all');
                    setSupExpFilterStatus('all');
                    setSupExpFilterDate('');
                    setIsDeleteMode(false);
                    setDeletingLog(null);
                    setIsIncDeleteMode(false);
                    setDeletingIncLog(null);
                    setIsBillDeleteMode(false);
                    setDeletingBillLog(null);
                  }}
                >
                  Expenditure
                </button>
                <button
                  className={`segmented-nav-btn ${supervisorTab === 'bills' ? 'active' : ''}`}
                  onClick={() => {
                    setSupervisorTab('bills');
                    setSelectedSupervisorMonth(null);
                    setIsDeleteMode(false);
                    setDeletingLog(null);
                    setIsIncDeleteMode(false);
                    setDeletingIncLog(null);
                    setIsBillDeleteMode(false);
                    setDeletingBillLog(null);
                  }}
                >
                  Bills
                </button>
                <button
                  className={`segmented-nav-btn ${supervisorTab === 'settlement' ? 'active' : ''}`}
                  onClick={() => {
                    setSupervisorTab('settlement');
                    setIsDeleteMode(false);
                    setDeletingLog(null);
                    setIsIncDeleteMode(false);
                    setDeletingIncLog(null);
                    setIsBillDeleteMode(false);
                    setDeletingBillLog(null);
                  }}
                >
                  Settlement
                </button>
              </div>

              {/* Offline Sync Status Badge */}
              {offlineCount > 0 && (
                <div style={{
                  backgroundColor: '#fffbeb',
                  border: '1px solid #fef3c7',
                  borderRadius: '6px',
                  padding: '0.5rem 0.75rem',
                  marginBottom: '1rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: '12px',
                  color: '#b45309',
                  fontWeight: 600
                }}>
                  <span>⏳ {offlineCount} bill chit(s) pending sync</span>
                  <button 
                    type="button"
                    className="btn btn-secondary btn-sm" 
                    onClick={syncOfflineQueue} 
                    disabled={syncingOffline}
                    style={{ padding: '2px 8px', fontSize: '11px', margin: 0, height: 'auto', minHeight: 'unset' }}
                  >
                    {syncingOffline ? 'Syncing...' : 'Sync Now'}
                  </button>
                </div>
              )}

              {supervisorTab === 'income' && (
                /* TAB A: INCOME LOGS (CASH INFLOW) */
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {/* Form */}
                  <form onSubmit={handleIncomeSubmit} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <h3 style={{ fontSize: '14px', margin: 0 }}>Record Received Cash</h3>

                    <div className="form-group">
                      <label className="form-label">CASH AMOUNT (₹)</label>
                      <input
                        type="number"
                        className="form-control"
                        placeholder="0.00"
                        step="0.01"
                        min="1"
                        value={incomeAmount}
                        onChange={(e) => setIncomeAmount(e.target.value)}
                        required
                        style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--color-orange)' }}
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label">LOG DATE</label>
                      <input
                        type="date"
                        className="form-control"
                        value={incomeDate}
                        onChange={(e) => setIncomeDate(e.target.value)}
                        max={todayStr}
                        required
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label">NOTES / REMARKS</label>
                      <input
                        type="text"
                        className="form-control"
                        placeholder="E.g., Received from Amit at head office"
                        value={incomeNote}
                        onChange={(e) => setIncomeNote(e.target.value)}
                      />
                    </div>

                    <button type="submit" className="btn btn-primary" disabled={actionLoading}>
                      {actionLoading ? 'Syncing...' : 'Log Cash Received'}
                    </button>
                  </form>

                  {/* History */}
                  <div className="card" style={{ padding: '0.75rem', overflowX: 'auto' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem' }}>
                      <h3 style={{ fontSize: '14px', margin: 0 }}>Inflow History</h3>
                    </div>
                    {incomeLogs.length === 0 ? (
                      <p style={{ color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', padding: '1rem' }}>No cash records found.</p>
                    ) : (
                      <div className="month-list">
                        {getMonthsWithStats(incomeLogs).map(m => (
                          <div key={m.name} className="month-list-row" onClick={() => setSelectedSupervisorIncomeMonth(m.name)}>
                            <div className="month-row-left">
                              <div className="month-row-folder-icon">📁</div>
                              <span className="month-row-name">{m.name}</span>
                            </div>
                            <div className="month-row-badges">
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {supervisorTab === 'expenditure' && (
                /* TAB B: EXPENDITURE LOGS (CASH OUTFLOW) */
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {/* Form */}
                  <form onSubmit={handleExpenditureSubmit} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <h3 style={{ fontSize: '14px', margin: 0 }}>Record Outgoing Cash Payout</h3>
                    <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '-0.4rem 0 0.25rem 0', fontStyle: 'italic' }}>
                      💡 Only record cash payouts here (e.g. wages, small items without bills). If you have a bill/receipt photo, log it under the **Bills** tab instead.
                    </p>

                    {/* Outflow type selector */}
                    <div className="form-group">
                      <label className="form-label">PAYOUT TYPE</label>
                      <div className="segmented-nav" style={{ marginBottom: 0 }}>
                        <button
                          type="button"
                          className={`segmented-nav-btn ${expenditureType === 'labour' ? 'active' : ''}`}
                          onClick={() => setExpenditureType('labour')}
                        >
                          Labourer Wages
                        </button>
                        <button
                          type="button"
                          className={`segmented-nav-btn ${expenditureType === 'general' ? 'active' : ''}`}
                          onClick={() => setExpenditureType('general')}
                        >
                          Site Expense
                        </button>
                        <button
                          type="button"
                          className={`segmented-nav-btn ${expenditureType === 'supervisor' ? 'active' : ''}`}
                          onClick={() => setExpenditureType('supervisor')}
                        >
                          To Supervisors
                        </button>
                      </div>
                    </div>

                    <div className="form-group">
                      <label className="form-label">AMOUNT PAID (₹)</label>
                      <input
                        type="number"
                        className="form-control"
                        placeholder="0.00"
                        step="0.01"
                        min="1"
                        value={expenditureAmount}
                        onChange={(e) => setExpenditureAmount(e.target.value)}
                        required
                        style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--color-orange)' }}
                      />
                    </div>

                    {expenditureType === 'labour' && (
                      <>
                        <div className="form-group">
                          <label className="form-label">SELECT LABOURER</label>
                          <select
                            className="form-control"
                            value={selectedLabourerId}
                            onChange={(e) => setSelectedLabourerId(e.target.value)}
                            required
                          >
                            <option value="" disabled>-- Choose Labourer --</option>
                            {labourers.map(l => (
                              <option key={l.id} value={l.id}>{l.name}</option>
                            ))}
                            <option value="other">Other Labours</option>
                          </select>
                        </div>
                        {selectedLabourerId === 'other' && (
                          <div className="form-group">
                            <label className="form-label">OTHER LABOURER NAME</label>
                            <input
                              type="text"
                              className="form-control"
                              placeholder="E.g., Ramesh Kumar"
                              value={otherLabourerName}
                              onChange={(e) => setOtherLabourerName(e.target.value)}
                              required
                            />
                          </div>
                        )}
                      </>
                    )}

                    {expenditureType === 'supervisor' && (
                      <div className="form-group">
                        <label className="form-label">SELECT SUPERVISOR</label>
                        <select
                          className="form-control"
                          value={selectedToSupervisorId}
                          onChange={(e) => setSelectedToSupervisorId(e.target.value)}
                          required
                        >
                          <option value="" disabled>-- Choose Supervisor --</option>
                          {supervisors
                            .filter(s => s.id !== supervisorUser.id)
                            .map(s => (
                              <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div className="form-group">
                      <label className="form-label">LOG DATE</label>
                      <input
                        type="date"
                        className="form-control"
                        value={expenditureDate}
                        onChange={(e) => setExpenditureDate(e.target.value)}
                        max={todayStr}
                        required
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label">DESCRIPTION / REMARK</label>
                      <input
                        type="text"
                        className="form-control"
                        placeholder={expenditureType === 'supervisor' ? "E.g., advance, settlement" : (expenditureType === 'labour' ? "E.g., Excavator support helper wage" : "E.g., Fuel excavator, tea for workers, etc...")}
                        value={expenditureNote}
                        onChange={(e) => setExpenditureNote(e.target.value)}
                      />
                    </div>

                    <button type="submit" className="btn btn-primary" disabled={actionLoading}>
                      {actionLoading ? 'Syncing...' : 'Log Payout Outflow'}
                    </button>
                  </form>

                  {/* History */}
                  <div className="card" style={{ padding: '0.75rem', overflowX: 'auto' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem' }}>
                      <h3 style={{ fontSize: '14px', margin: 0 }}>Outflow History</h3>
                    </div>
                    {(() => {
                      const filteredLogs = expenditureLogs;
                      
                      if (filteredLogs.length === 0) {
                        return <p style={{ color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', padding: '1rem' }}>No payout records found.</p>;
                      }
                      return (
                        <div className="month-list">
                          {getMonthsWithStats(filteredLogs).map(m => (
                          <div key={m.name} className="month-list-row" onClick={() => setSelectedSupervisorExpenditureMonth(m.name)}>
                            <div className="month-row-left">
                              <div className="month-row-folder-icon">📁</div>
                              <span className="month-row-name">{m.name}</span>
                            </div>
                            <div className="month-row-badges">
                              {m.pendingCount > 0 && <span className="badge-pending">{m.pendingCount} Pending</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                      );
                    })()}
                  </div>
                </div>
              )}

              {supervisorTab === 'bills' && (
                /* TAB C: BILLS (EXISTING RECEIPT UPLOADS) */
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <form onSubmit={handleExpenseSubmit} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <h3 style={{ fontSize: '14px', margin: 0 }}>Upload Material Receipt Bill</h3>
                    <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '-0.4rem 0 0.25rem 0', fontStyle: 'italic' }}>
                      💡 Do not log this bill under Cash Expenditures. Logging it here is sufficient and unique.
                    </p>

                    {/* Amount input */}
                    <div className="form-group">
                      <label className="form-label">BILL AMOUNT (₹)</label>
                      <input
                        type="number"
                        className="form-control"
                        placeholder="0.00"
                        step="0.01"
                        min="0.01"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        required
                        style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--color-orange)' }}
                      />
                    </div>

                    {/* Photo Capture widget */}
                    <div className="form-group">
                      <label className="form-label">ATTACH BILL RECEIPT PHOTO</label>

                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        id="receipt-photo-camera"
                        onChange={handleFileChange}
                        style={{ display: 'none' }}
                      />
                      <input
                        type="file"
                        accept="image/*"
                        id="receipt-photo-gallery"
                        onChange={handleFileChange}
                        style={{ display: 'none' }}
                      />

                      {loading ? (
                        <div className="camera-card" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.4rem', padding: '1.5rem', border: '2px dashed var(--border-color)', borderRadius: '6px' }}>
                          <div className="loader" style={{ color: 'var(--color-orange)' }}></div>
                          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Compressing Image...</span>
                        </div>
                      ) : previewUrl ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'center', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '0.75rem', backgroundColor: '#f8fafc' }}>
                          <img src={previewUrl} alt="Compressed preview" style={{ maxWidth: '100%', maxHeight: '180px', borderRadius: '4px', objectFit: 'contain' }} />
                          <span style={{ fontSize: '12px', color: 'var(--color-success)', fontWeight: '600' }}>
                            ✓ Compressed under 150KB
                          </span>
                          <div style={{ display: 'flex', gap: '0.5rem', width: '100%', marginTop: '0.25rem' }}>
                            <label htmlFor="receipt-photo-camera" className="btn btn-secondary btn-sm" style={{ flex: 1, display: 'inline-flex', justifyContent: 'center', alignItems: 'center', gap: '0.2rem', cursor: 'pointer', fontSize: '12px', padding: '0.35rem 0.5rem', margin: 0 }}>
                              📷 Retake
                            </label>
                            <label htmlFor="receipt-photo-gallery" className="btn btn-secondary btn-sm" style={{ flex: 1, display: 'inline-flex', justifyContent: 'center', alignItems: 'center', gap: '0.2rem', cursor: 'pointer', fontSize: '12px', padding: '0.35rem 0.5rem', margin: 0 }}>
                              🖼️ Gallery
                            </label>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <label
                            htmlFor="receipt-photo-camera"
                            className="camera-card"
                            style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: '2px dashed var(--border-color)', borderRadius: '6px', padding: '1.25rem 0.5rem', cursor: 'pointer', textAlign: 'center', gap: '0.25rem' }}
                          >
                            <span style={{ fontSize: '24px' }}>📷</span>
                            <span style={{ fontSize: '13px', fontWeight: '600' }}>Take Photo</span>
                            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Open Camera</span>
                          </label>

                          <label
                            htmlFor="receipt-photo-gallery"
                            className="camera-card"
                            style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: '2px dashed var(--border-color)', borderRadius: '6px', padding: '1.25rem 0.5rem', cursor: 'pointer', textAlign: 'center', gap: '0.25rem' }}
                          >
                            <span style={{ fontSize: '24px' }}>🖼️</span>
                            <span style={{ fontSize: '13px', fontWeight: '600' }}>Photo Gallery</span>
                            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Choose Image</span>
                          </label>
                        </div>
                      )}
                    </div>

                    {/* Note input */}
                    <div className="form-group">
                      <label className="form-label">NOTE / DESCRIPTION</label>
                      <textarea
                        className="form-control"
                        rows="2"
                        placeholder="Fuel excavator, tea for workers, etc..."
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                      />
                    </div>

                    {/* Date selector */}
                    <div className="form-group">
                      <label className="form-label">LOG DATE</label>
                      <input
                        type="date"
                        className="form-control"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        max={todayStr}
                        required
                      />
                    </div>

                    <button type="submit" className="btn btn-primary btn-submit-chit" disabled={actionLoading || loading}>
                      {actionLoading ? 'Syncing...' : 'Send Chit to Office'}
                    </button>
                  </form>

                  {/* Supervisor Recent Bills list */}
                  <div className="card" style={{ padding: '0.75rem', overflowX: 'auto' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.65rem' }}>
                      <h3 style={{ fontSize: '1.1rem', margin: 0 }}>My Recent Bills</h3>
                    </div>

                    {myRecentBills.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-muted)', fontSize: '13px' }}>
                        No bills synced yet.
                      </div>
                    ) : (
                      <div className="month-list">
                        {getMonthsWithStats(myRecentBills).map(m => (
                          <div key={m.name} className="month-list-row" onClick={() => setSelectedSupervisorMonth(m.name)}>
                            <div className="month-row-left">
                              <div className="month-row-folder-icon">📁</div>
                              <span className="month-row-name">{m.name}</span>
                            </div>
                            <div className="month-row-badges">
                              {m.pendingCount > 0 && <span className="badge-pending">{m.pendingCount} Pending</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {supervisorTab === 'settlement' && (
                <div className="card" style={{ padding: '0.75rem' }}>
                  <h3 style={{ fontSize: '14px', marginBottom: '0.75rem' }}>My Monthly Settlements</h3>
                  {(() => {
                    const { monthlyReports } = getSupervisorMonthlySettlements(supervisorUser.id);
                    if (monthlyReports.length === 0) {
                      return <p style={{ color: 'var(--text-muted)', fontSize: '13px', padding: '1rem', textAlign: 'center' }}>No logs or history available.</p>;
                    }

                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {monthlyReports.slice().reverse().map(report => (
                          <div
                            key={report.month}
                            className={`settlement-card ${report.isSettled ? 'settled' : 'pending'}`}
                          >
                            <div className="settlement-header">
                              <div className="settlement-header-main">
                                <span className="settlement-month">{report.month}</span>
                                <span className={`settlement-status-pill ${report.isSettled ? 'settled' : 'pending'}`}>
                                  {report.isSettled ? '✓ Settled' : 'Pending'}
                                </span>
                              </div>
                              <div className="settlement-opening-bal">
                                <span className="bal-label">Opening Bal</span>
                                <span className="bal-amount">₹{report.openingBalance.toFixed(2)}</span>
                              </div>
                            </div>

                            <div className="settlement-metrics-grid">
                              <div className="metric-box inflow-box">
                                <span className="metric-label">Cash Received</span>
                                <span className="metric-value">₹{report.inflow.toFixed(2)}</span>
                              </div>
                              <div className="metric-box payout-box">
                                <span className="metric-label">Payouts Outflow</span>
                                <span className="metric-value">₹{report.outflowExpenditures.toFixed(2)}</span>
                              </div>
                              <div className="metric-box bills-box">
                                <span className="metric-label">Bills (Receipts)</span>
                                <span className="metric-value">₹{report.outflowBills.toFixed(2)}</span>
                              </div>
                              <div className="metric-box inhand-box">
                                <span className="metric-label">In Hand (Month End)</span>
                                <span className="metric-value">₹{report.cashLeft.toFixed(2)}</span>
                              </div>
                            </div>

                            {report.isSettled && (
                              <div className="settlement-calc-section">
                                <div className="salary-input-wrapper">
                                  <span className="salary-label">Monthly Salary</span>
                                  <span style={{ fontSize: '15px', fontWeight: '700', fontFamily: 'var(--font-mono)', color: '#0f172a' }}>
                                    ₹{report.salary.toFixed(2)}
                                  </span>
                                </div>
                                <div className={`calc-result-box ${report.netSalary < 0 ? 'owes' : 'excess'}`}>
                                  <span className="calc-label">
                                    {report.netSalary < 0 ? 'Company Owes' : (report.netSalary > 0 ? 'Excess Cash Carried' : 'Balance')}
                                  </span>
                                  <span className="calc-value">
                                    ₹{Math.abs(report.netSalary).toFixed(2)}
                                  </span>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )}

            </>
          )}
        </div>
      )}

      {/* 5. SCREEN: OFFICE ADMIN DASHBOARD */}
      {screen === 'admin-dashboard' && (
        <div className="admin-container">

          {/* Admin Tabs */}
          {selectedAdminSup === null && (
            <div className="segmented-nav">
              <button
                className={`segmented-nav-btn ${activeTab === 'logs' ? 'active' : ''}`}
                onClick={() => {
                  setActiveTab('logs');
                  setExpFilterLabourerId('all');
                  setExpFilterStatus('all');
                  setFilterDate('');
                  setFilterStatus('all');
                  setSelectedLookupLabourerId('');
                  setNewLabourerName('');
                  setNewSupName('');
                  setNewSupPin('');
                  setSelectedAdminMonth(null);
                  setSelectedAdminSup(null);
                }}
              >
                <span className="desktop-only">Supervisor </span>Logs
              </button>
              <button
                className={`segmented-nav-btn ${activeTab === 'supervisors' ? 'active' : ''}`}
                onClick={() => {
                  setActiveTab('supervisors');
                  setExpFilterLabourerId('all');
                  setExpFilterStatus('all');
                  setFilterDate('');
                  setFilterStatus('all');
                  setSelectedLookupLabourerId('');
                  setNewLabourerName('');
                  setNewSupName('');
                  setNewSupPin('');
                  setSelectedAdminMonth(null);
                  setSelectedAdminSup(null);
                }}
              >
                <span className="desktop-only">Manage </span>Supervisors
              </button>
              <button
                className={`segmented-nav-btn ${activeTab === 'labourers' ? 'active' : ''}`}
                onClick={() => {
                  setActiveTab('labourers');
                  setExpFilterLabourerId('all');
                  setExpFilterStatus('all');
                  setFilterDate('');
                  setFilterStatus('all');
                  setSelectedLookupLabourerId('');
                  setNewLabourerName('');
                  setNewSupName('');
                  setNewSupPin('');
                  setSelectedAdminMonth(null);
                  setSelectedAdminSup(null);
                }}
              >
                <span className="desktop-only">Manage </span>Labourers
              </button>
            </div>
          )}

          {/* TAB 1: SUPERVISOR LOGS */}
          {activeTab === 'logs' && (
            <div>
              {selectedAdminSup === null ? (
                // A. MAIN FLAT LIST VIEW: SHOW ALL SUPERVISORS
                <div>
                  <div style={{ marginBottom: '1rem' }}>
                    <h2 style={{ fontSize: '1.4rem' }}>Select Supervisor to Verify</h2>
                    <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
                      Click on a site supervisor to view their logged receipt chits and verify details.
                    </p>
                  </div>

                  {supervisors.length === 0 ? (
                    <div className="card" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)', fontSize: '13px' }}>
                      No supervisors configured in the system. Go to "Manage Supervisors" to add one.
                    </div>
                  ) : (
                    <div className="supervisor-grid">
                      {supervisorsWithStats.map(sup => {
                        // Extract first two letters for avatar initials
                        const initials = sup.name
                          .split(' ')
                          .map(w => w[0])
                          .join('')
                          .substring(0, 2);

                        // Select a background color dynamically based on initials
                        const colors = ['#e8590c', '#1c7ed6', '#37b24d', '#7048e8', '#f59f00', '#1098ad', '#ae3ec9'];
                        const colorIndex = sup.name.charCodeAt(0) % colors.length;
                        const avatarBg = colors[colorIndex];

                        return (
                          <div
                            key={sup.id}
                            className="supervisor-cube-card"
                            onClick={() => {
                              setSelectedAdminSup(sup);
                              setFilterDate(''); // Clear date filter when entering a new supervisor
                              setFilterStatus('all'); // Reset status filter
                              setExpFilterLabourerId('all'); // Reset expenditure filters
                              setExpFilterStatus('all');
                              setSelectedAdminMonth(null); // Clear selected month folder
                              setAdminLogsTab('income'); // Reset sub-tab to income
                            }}
                          >
                            <div className="supervisor-avatar" style={{ backgroundColor: avatarBg }}>
                              {initials}
                            </div>
                            <h3 className="supervisor-name">{sup.name}</h3>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                // B. DRILL-DOWN VIEW: SHOW DETAILED LOGS FOR THE SELECTED SUPERVISOR
                <div>

                  {/* Top nav bar inside drill-down */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      {selectedAdminMonth && adminLogsTab === 'bills' ? (
                        <button
                          className="btn btn-outline btn-sm"
                          onClick={() => setSelectedAdminMonth(null)}
                          style={{ padding: '0.25rem 0.5rem' }}
                        >
                          Back to Months
                        </button>
                      ) : (
                        <button
                          className="btn btn-outline btn-sm"
                          onClick={() => {
                            setSelectedAdminSup(null);
                            setSelectedAdminMonth(null);
                            setExpFilterLabourerId('all');
                            setExpFilterStatus('all');
                            setFilterDate('');
                            setFilterStatus('all');
                          }}
                          style={{ padding: '0.25rem 0.5rem' }}
                        >
                          Back to List
                        </button>
                      )}
                      <h2 style={{ fontSize: '1.25rem', margin: 0 }}>
                        {selectedAdminSup.name} {selectedAdminMonth && adminLogsTab === 'bills' ? `/ ${selectedAdminMonth}` : ''}
                      </h2>
                    </div>
                  </div>

                  {/* Summary Current Month Card */}
                  {(() => {
                    const { monthlyReports, currentInHandBalance } = getSupervisorMonthlySettlements(selectedAdminSup.id);
                    const currentReport = monthlyReports.length > 0 ? monthlyReports[monthlyReports.length - 1] : null;
                    const displayMonthName = currentReport ? currentReport.month : new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });
                    const inflow = currentReport ? currentReport.inflow : 0;
                    const outflowExp = currentReport ? currentReport.outflowExpenditures : 0;
                    const outflowBills = currentReport ? currentReport.outflowBills : 0;
                    const inHand = currentReport ? currentReport.cashLeft : currentInHandBalance;
                    const openingBal = currentReport ? currentReport.openingBalance : 0;

                    return (
                      <div className="current-month-summary-card">
                        <div className="summary-card-header">
                          <div className="summary-card-title">
                            <span className="month-badge-dot"></span>
                            <span>{displayMonthName} Summary</span>
                          </div>
                          <div className="summary-opening-tag">
                            Opening Bal: ₹{openingBal.toFixed(2)}
                          </div>
                        </div>

                        <div className="summary-grid-2x2">
                          <div className="summary-stat-box">
                            <span className="stat-label">Cash Received (Inflow)</span>
                            <span className="stat-value text-success">₹{inflow.toFixed(2)}</span>
                          </div>
                          <div className="summary-stat-box">
                            <span className="stat-label">Outflows (Payouts)</span>
                            <span className="stat-value text-danger">₹{outflowExp.toFixed(2)}</span>
                          </div>
                          <div className="summary-stat-box">
                            <span className="stat-label">Bills (Receipts)</span>
                            <span className="stat-value text-danger">₹{outflowBills.toFixed(2)}</span>
                          </div>
                          <div className="summary-stat-box summary-stat-inhand">
                            <span className="stat-label">In Hand Balance</span>
                            <span className="stat-value text-dark">₹{inHand.toFixed(2)}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Segmented Sub-Tab Navigation Bar */}
                  <div className="segmented-nav">
                    <button
                      className={`segmented-nav-btn ${adminLogsTab === 'income' ? 'active' : ''}`}
                      onClick={() => {
                        setAdminLogsTab('income');
                        setSelectedAdminMonth(null);
                        setExpFilterLabourerId('all');
                        setExpFilterStatus('all');
                        setFilterDate('');
                        setFilterStatus('all');
                      }}
                    >
                      Income
                    </button>
                    <button
                      className={`segmented-nav-btn ${adminLogsTab === 'expenditure' ? 'active' : ''}`}
                      onClick={() => {
                        setAdminLogsTab('expenditure');
                        setSelectedAdminMonth(null);
                        setExpFilterLabourerId('all');
                        setExpFilterStatus('all');
                        setFilterDate('');
                        setFilterStatus('all');
                      }}
                    >
                      Expenditure
                    </button>
                    <button
                      className={`segmented-nav-btn ${adminLogsTab === 'bills' ? 'active' : ''}`}
                      onClick={() => {
                        setAdminLogsTab('bills');
                        setSelectedAdminMonth(null);
                        setExpFilterLabourerId('all');
                        setExpFilterStatus('all');
                        setFilterDate('');
                        setFilterStatus('all');
                      }}
                    >
                      Bills
                    </button>
                    <button
                      className={`segmented-nav-btn ${adminLogsTab === 'settlement' ? 'active' : ''}`}
                      onClick={() => {
                        setAdminLogsTab('settlement');
                        setSelectedAdminMonth(null);
                      }}
                    >
                      Settlement
                    </button>
                  </div>

                  {/* Sub-tab 1: INCOME HISTORY */}
                  {adminLogsTab === 'income' && (
                    <div>
                      {selectedAdminMonth === null ? (
                        // Month Folders for Income
                        <div className="card" style={{ padding: '0.75rem' }}>
                          <h3 style={{ fontSize: '14px', marginBottom: '0.75rem' }}>Monthly Inflow Folders</h3>
                          {(() => {
                            const supIncome = incomeLogs.filter(i => i.supervisor_id === selectedAdminSup.id);
                            const months = getMonthsWithStats(supIncome);
                            if (months.length === 0) {
                              return <p style={{ color: 'var(--text-muted)', fontSize: '13px', padding: '1rem', textAlign: 'center' }}>No cash records found for this supervisor.</p>;
                            }
                            return (
                              <div className="month-list">
                                {months.map(m => (
                                  <div key={m.name} className="month-list-row" onClick={() => setSelectedAdminMonth(m.name)}>
                                    <div className="month-row-left">
                                      <div className="month-row-folder-icon">📁</div>
                                      <span className="month-row-name">{m.name}</span>
                                    </div>
                                    <div className="month-row-badges">
                                    </div>
                                  </div>
                                ))}
                              </div>
                            );
                          })()}
                        </div>
                      ) : (
                        // Table Ledger for selected month
                        <div className="card card-table-container">
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                            <h3 style={{ fontSize: '14px', margin: 0 }}>Cash Received (Income) - {selectedAdminMonth}</h3>
                            <button
                              className="btn btn-outline btn-sm"
                              onClick={() => setSelectedAdminMonth(null)}
                              style={{ width: 'auto', padding: '0.2rem 0.5rem', fontSize: '12px' }}
                            >
                              ← Back to Months
                            </button>
                          </div>
                          {(() => {
                            const filteredIncome = incomeLogs.filter(i => {
                              const matchesSup = i.supervisor_id === selectedAdminSup.id;
                              if (!matchesSup) return false;

                              if (!i.date) return false;
                              const parts = i.date.split('-');
                              if (parts.length < 2) return false;
                              const dateObj = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, 1);
                              const mName = dateObj.toLocaleString('default', { month: 'long', year: 'numeric' });
                              return mName === selectedAdminMonth;
                            });

                            if (filteredIncome.length === 0) {
                              return <p style={{ color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', padding: '1rem' }}>No cash records found for this month.</p>;
                            }

                            return (
                              <table className="ledger-table inc-table">
                                <thead>
                                  <tr>
                                    <th className="col-date">DATE</th>
                                    <th className="col-desc">FROM</th>
                                    <th className="col-amount">AMOUNT</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {filteredIncome.map(log => (
                                    <tr key={log.id}>
                                      <td style={{ whiteSpace: 'nowrap' }}>{formatDate(log.date)}</td>
                                      <td>{log.note || 'Office Admin'}</td>
                                      <td style={{ textAlign: 'right', fontWeight: 'bold', color: 'var(--color-success)', whiteSpace: 'nowrap' }}>
                                        ₹{parseFloat(log.amount).toFixed(2)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Sub-tab 2: EXPENDITURE HISTORY */}
                  {adminLogsTab === 'expenditure' && (
                    <div>
                      {selectedAdminMonth === null ? (
                        // Month Folders for Expenditure
                        <div className="card" style={{ padding: '0.75rem' }}>
                          <h3 style={{ fontSize: '14px', marginBottom: '0.75rem' }}>Monthly Outflow Folders</h3>
                          {(() => {
                            const supExp = expenditureLogs.filter(e => e.supervisor_id === selectedAdminSup.id);
                            const months = getMonthsWithStats(supExp);
                            if (months.length === 0) {
                              return <p style={{ color: 'var(--text-muted)', fontSize: '13px', padding: '1rem', textAlign: 'center' }}>No payout records found for this supervisor.</p>;
                            }
                            return (
                              <div className="month-list">
                                {months.map(m => (
                                  <div key={m.name} className="month-list-row" onClick={() => setSelectedAdminMonth(m.name)}>
                                    <div className="month-row-left">
                                      <div className="month-row-folder-icon">📁</div>
                                      <span className="month-row-name">{m.name}</span>
                                    </div>
                                    <div className="month-row-badges">
                                      {m.pendingCount > 0 && <span className="badge-pending">{m.pendingCount} Pending</span>}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            );
                          })()}
                        </div>
                      ) : (
                        // Table Ledger for selected month (with filters)
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>

                          {/* Filters & Back Button Row */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                            <button
                              className="btn btn-outline btn-sm"
                              onClick={() => {
                                setSelectedAdminMonth(null);
                                setExpFilterLabourerId('all');
                                setExpFilterStatus('all');
                              }}
                              style={{ width: 'auto', padding: '0.2rem 0.5rem', fontSize: '12px' }}
                            >
                              ← Back to Months
                            </button>
                            <h3 style={{ fontSize: '14px', margin: 0 }}>Cash Spent (Expenditure) - {selectedAdminMonth}</h3>
                          </div>

                          {/* Filters: Labourer Selector + Status Dropdown */}
                          <div className="card admin-filter-row" style={{ padding: '0.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                            <div className="form-group" style={{ flex: 1, minWidth: 0, marginBottom: 0 }}>
                              <label className="form-label" style={{ fontSize: '10px' }}>FILTER BY LABOURER</label>
                              <select
                                className="form-control"
                                value={expFilterLabourerId}
                                onChange={(e) => setExpFilterLabourerId(e.target.value)}
                                style={{ padding: '0.35rem 0.5rem', fontSize: '13px' }}
                              >
                                <option value="all">All Payouts</option>
                                <option value="general">General Site Expenses Only</option>
                                <option value="supervisor">Payments to Supervisors</option>
                                <optgroup label="Labourers">
                                  {labourers.map(l => (
                                    <option key={l.id} value={l.id}>{l.name}</option>
                                  ))}
                                </optgroup>
                              </select>
                            </div>

                            <div className="form-group" style={{ flex: 1, minWidth: 0, marginBottom: 0 }}>
                              <label className="form-label" style={{ fontSize: '10px' }}>FILTER STATUS</label>
                              <select
                                className="form-control"
                                value={expFilterStatus}
                                onChange={(e) => setExpFilterStatus(e.target.value)}
                                style={{ padding: '0.35rem 0.5rem', fontSize: '13px' }}
                              >
                                <option value="all">All Logs</option>
                                <option value="pending">Pending Only</option>
                                <option value="verified">Verified Only</option>
                              </select>
                            </div>
                          </div>

                          {/* Table container */}
                          <div className="card card-table-container">
                            {(() => {
                              const filteredExp = expenditureLogs.filter(e => {
                                const matchesSup = e.supervisor_id === selectedAdminSup.id;
                                if (!matchesSup) return false;

                                if (!e.date) return false;
                                const parts = e.date.split('-');
                                if (parts.length < 2) return false;
                                const dateObj = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, 1);
                                const mName = dateObj.toLocaleString('default', { month: 'long', year: 'numeric' });
                                if (mName !== selectedAdminMonth) return false;

                                const matchesLabourer =
                                  expFilterLabourerId === 'all' ||
                                  (expFilterLabourerId === 'general' && e.type === 'general') ||
                                  (expFilterLabourerId === 'supervisor' && e.type === 'supervisor') ||
                                  (expFilterLabourerId !== 'general' && expFilterLabourerId !== 'supervisor' && e.type === 'labour' && e.labourer_id === expFilterLabourerId);
                                const matchesStatus =
                                  expFilterStatus === 'all' ||
                                  (expFilterStatus === 'verified' && e.verified) ||
                                  (expFilterStatus === 'pending' && !e.verified);
                                return matchesLabourer && matchesStatus;
                              });

                              if (filteredExp.length === 0) {
                                return <p style={{ color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', padding: '1rem' }}>No payout records match the selected filters.</p>;
                              }

                              return (
                                <table className="ledger-table exp-table">
                                  <thead>
                                    <tr>
                                      <th className="col-date">DATE</th>
                                      <th className="col-desc">ITEM</th>
                                      <th className="col-amount">AMOUNT</th>
                                      <th className="col-status">VERIFY</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {filteredExp.map(log => (
                                      <tr key={log.id}>
                                        <td style={{ whiteSpace: 'nowrap' }}>{formatDate(log.date)}</td>
                                        <td>
                                          {log.type === 'labour' ? (
                                            <span><strong>Labour:</strong> {log.labourer_name} {log.note && `(${log.note})`}</span>
                                          ) : log.type === 'supervisor' ? (
                                            <span><strong>To Supervisor:</strong> {log.to_supervisor_name} {log.note && `(${log.note})`}</span>
                                          ) : (
                                            <span><strong>General:</strong> {log.note || 'Site expense'}</span>
                                          )}
                                        </td>
                                        <td style={{ textAlign: 'right', fontWeight: 'bold', color: 'var(--color-danger)', whiteSpace: 'nowrap' }}>
                                          ₹{parseFloat(log.amount).toFixed(2)}
                                        </td>
                                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                                          <label style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', gap: '0.2rem', margin: 0 }}>
                                            <input
                                              type="checkbox"
                                              checked={!!log.verified}
                                              onChange={() => handleToggleVerifyExpenditure(log)}
                                              disabled={actionLoading}
                                              style={{ width: '15px', height: '15px', accentColor: '#ea580c', cursor: 'pointer' }}
                                            />
                                          </label>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              );
                            })()}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Sub-tab 3: BILLS */}
                  {adminLogsTab === 'bills' && (
                    <div>
                      {selectedAdminMonth === null ? (
                        // Month Folders for Bills
                        <div className="card" style={{ padding: '0.75rem' }}>
                          <h3 style={{ fontSize: '14px', marginBottom: '0.75rem' }}>Monthly Log Folders</h3>
                          {(() => {
                            const supExpenses = expenses.filter(exp => exp.supervisor_id === selectedAdminSup.id || exp.supervisor_name === selectedAdminSup.name);
                            const months = getMonthsWithStats(supExpenses);
                            if (months.length === 0) {
                              return <p style={{ color: 'var(--text-muted)', fontSize: '13px', padding: '1rem', textAlign: 'center' }}>No logs found for this supervisor.</p>;
                            }
                            return (
                              <div className="month-list">
                                {months.map(m => (
                                  <div key={m.name} className="month-list-row" onClick={() => setSelectedAdminMonth(m.name)}>
                                    <div className="month-row-left">
                                      <div className="month-row-folder-icon">📁</div>
                                      <span className="month-row-name">{m.name}</span>
                                    </div>
                                    <div className="month-row-badges">
                                      {m.pendingCount > 0 && <span className="badge-pending">{m.pendingCount} Pending</span>}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            );
                          })()}
                        </div>
                      ) : (
                        // Table Ledger for selected month (with filters)
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>

                          {/* Filters & Back Button Row */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                            <button
                              className="btn btn-outline btn-sm"
                              onClick={() => {
                                setSelectedAdminMonth(null);
                                setFilterDate('');
                                setFilterStatus('all');
                              }}
                              style={{ width: 'auto', padding: '0.2rem 0.5rem', fontSize: '12px' }}
                            >
                              ← Back to Months
                            </button>
                            <h3 style={{ fontSize: '14px', margin: 0 }}>Receipt Bills (Verify Chits) - {selectedAdminMonth}</h3>
                          </div>

                          {/* Filters: Date Selector + Status Dropdown */}
                          <div className="card admin-filter-row" style={{ padding: '0.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                            <div className="form-group" style={{ flex: 1, minWidth: 0, marginBottom: 0 }}>
                              <label className="form-label" style={{ fontSize: '10px' }}>FILTER BY DATE</label>
                              <div style={{ display: 'flex', gap: '0.25rem' }}>
                                <input
                                  type="date"
                                  className="form-control"
                                  value={filterDate}
                                  onChange={(e) => setFilterDate(e.target.value)}
                                  style={{ padding: '0.35rem 0.5rem', fontSize: '13px' }}
                                />
                                {filterDate && (
                                  <button
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => setFilterDate('')}
                                    style={{ padding: '0.35rem 0.5rem', width: 'auto' }}
                                  >
                                    Clear
                                  </button>
                                )}
                              </div>
                            </div>

                            <div className="form-group" style={{ flex: 1, minWidth: 0, marginBottom: 0 }}>
                              <label className="form-label" style={{ fontSize: '10px' }}>FILTER STATUS</label>
                              <select
                                className="form-control"
                                value={filterStatus}
                                onChange={(e) => setFilterStatus(e.target.value)}
                                style={{ padding: '0.35rem 0.5rem', fontSize: '13px' }}
                              >
                                <option value="all">All Logs</option>
                                <option value="pending">Pending Only</option>
                                <option value="verified">Verified Only</option>
                              </select>
                            </div>
                          </div>

                          {/* Bills Ledger Table */}
                          <div className="card card-table-container">
                            {(() => {
                              const filteredExpenses = expenses.filter(exp => {
                                const matchesSupervisor = exp.supervisor_id === selectedAdminSup.id || exp.supervisor_name === selectedAdminSup.name;
                                if (!matchesSupervisor) return false;

                                if (!exp.date) return false;
                                const parts = exp.date.split('-');
                                if (parts.length < 2) return false;
                                const dateObj = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, 1);
                                const mName = dateObj.toLocaleString('default', { month: 'long', year: 'numeric' });
                                if (mName !== selectedAdminMonth) return false;

                                const matchesStatus =
                                  filterStatus === 'all' ||
                                  (filterStatus === 'verified' && exp.verified) ||
                                  (filterStatus === 'pending' && !exp.verified);
                                const matchesDate = !filterDate || exp.date === filterDate;
                                return matchesStatus && matchesDate;
                              });

                              if (filteredExpenses.length === 0) {
                                return <p style={{ color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', padding: '1rem' }}>No bills match the selected filters.</p>;
                              }

                              return (
                                <table className="ledger-table bills-table">
                                  <thead>
                                    <tr>
                                      <th className="col-date">DATE</th>
                                      <th className="col-desc">ITEM</th>
                                      <th className="col-amount">AMOUNT</th>
                                      <th className="col-status">VERIFY</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {filteredExpenses.map(exp => (
                                      <tr key={exp.id}>
                                        <td style={{ whiteSpace: 'nowrap' }}>{formatDate(exp.date)}</td>
                                        <td style={{ verticalAlign: 'middle' }}>
                                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.4rem' }}>
                                            <span style={{ flex: 1, minWidth: 0, wordBreak: 'break-word' }}>{exp.note || 'No description'}</span>
                                            {exp.photo_url && (
                                              <img
                                                src={exp.photo_url}
                                                alt="Chit Thumbnail"
                                                className="ledger-bill-thumb"
                                                onClick={() => setSelectedPhoto(exp.photo_url)}
                                                style={{ flexShrink: 0 }}
                                              />
                                            )}
                                          </div>
                                        </td>
                                        <td style={{ textAlign: 'right', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                                          ₹{parseFloat(exp.amount).toFixed(2)}
                                        </td>
                                        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                                          <label style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', gap: '0.2rem', margin: 0 }}>
                                            <input
                                              type="checkbox"
                                              checked={!!exp.verified}
                                              onChange={() => handleToggleVerify(exp)}
                                              disabled={actionLoading}
                                              style={{ width: '15px', height: '15px', accentColor: '#ea580c', cursor: 'pointer' }}
                                            />
                                          </label>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              );
                            })()}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {adminLogsTab === 'settlement' && (
                    <div className="card" style={{ padding: '0.75rem' }}>
                      <h3 style={{ fontSize: '14px', marginBottom: '0.75rem' }}>Monthly Cash Settlements</h3>
                      {(() => {
                        const { monthlyReports } = getSupervisorMonthlySettlements(selectedAdminSup.id);
                        if (monthlyReports.length === 0) {
                          return <p style={{ color: 'var(--text-muted)', fontSize: '13px', padding: '1rem', textAlign: 'center' }}>No logs or history available for settlement.</p>;
                        }

                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            {monthlyReports.slice().reverse().map((report, idx, arr) => {
                              const prevChronologicalMonth = arr[idx + 1];
                              const isPrevMonthPending = prevChronologicalMonth && !prevChronologicalMonth.isSettled;
                              const hasUnverifiedItems = report.unverifiedExpenditures > 0 || report.unverifiedBills > 0;

                              const inputKey = `${selectedAdminSup.id}-${report.month}`;
                              const currentVal = salaryInputs[inputKey] !== undefined
                                ? salaryInputs[inputKey]
                                : (report.isSettled ? report.salary.toString() : '');

                              const numericSalary = parseFloat(currentVal || 0);
                              const calculatedNet = report.isSettled
                                ? report.netSalary
                                : (report.cashLeft - numericSalary);

                              return (
                                <div
                                  key={report.month}
                                  className={`settlement-card ${report.isSettled ? 'settled' : 'pending'}`}
                                >
                                  {/* Header */}
                                  <div className="settlement-header">
                                    <div className="settlement-header-main">
                                      <span className="settlement-month">{report.month}</span>
                                      <span className={`settlement-status-pill ${report.isSettled ? 'settled' : 'pending'}`}>
                                        {report.isSettled ? '✓ Settled' : 'Pending'}
                                      </span>
                                    </div>
                                    <div className="settlement-opening-bal">
                                      <span className="bal-label">Opening Bal</span>
                                      <span className="bal-amount">₹{report.openingBalance.toFixed(2)}</span>
                                    </div>
                                  </div>

                                  {/* Verification alert bar */}
                                  {!report.isSettled && (
                                    <div className={`settlement-verify-bar ${hasUnverifiedItems ? 'warning' : 'success'}`}>
                                      {hasUnverifiedItems ? (
                                        <>
                                          <span>⚠️</span>
                                          <span><strong>{report.unverifiedExpenditures + report.unverifiedBills}</strong> Unverified Item{report.unverifiedExpenditures + report.unverifiedBills > 1 ? 's' : ''} Pending Approval</span>
                                        </>
                                      ) : (
                                        <>
                                          <span>✓</span>
                                          <span>All Monthly Items Verified & Approved</span>
                                        </>
                                      )}
                                    </div>
                                  )}

                                  {/* 2x2 Metrics Grid */}
                                  <div className="settlement-metrics-grid">
                                    <div className="metric-box inflow-box">
                                      <span className="metric-label">Cash Received (Inflow)</span>
                                      <span className="metric-value">₹{report.inflow.toFixed(2)}</span>
                                    </div>
                                    <div className="metric-box payout-box">
                                      <span className="metric-label">Cash Spent (Payouts)</span>
                                      <span className="metric-value">₹{report.outflowExpenditures.toFixed(2)}</span>
                                    </div>
                                    <div className="metric-box bills-box">
                                      <span className="metric-label">Bills (Receipts)</span>
                                      <span className="metric-value">₹{report.outflowBills.toFixed(2)}</span>
                                    </div>
                                    <div className="metric-box inhand-box">
                                      <span className="metric-label">In Hand (Month End)</span>
                                      <span className="metric-value">₹{report.cashLeft.toFixed(2)}</span>
                                    </div>
                                  </div>

                                  {/* Salary Calculation Section */}
                                  <div className="settlement-calc-section">
                                    <div className="salary-input-wrapper">
                                      <label className="salary-label">Monthly Salary</label>
                                      <div className="input-with-symbol">
                                        <span className="currency-symbol">₹</span>
                                        <input
                                          type="number"
                                          className="salary-input"
                                          placeholder="E.g. 30000"
                                          value={currentVal}
                                          disabled={report.isSettled || actionLoading}
                                          onChange={(e) => setSalaryInputs(prev => ({ ...prev, [inputKey]: e.target.value }))}
                                        />
                                      </div>
                                    </div>
                                    <div className={`calc-result-box ${calculatedNet < 0 ? 'owes' : 'excess'}`}>
                                      <span className="calc-label">
                                        {calculatedNet < 0 ? 'Company Owes' : (calculatedNet > 0 ? 'Excess Cash' : 'Balance Amount')}
                                      </span>
                                      <span className="calc-value">
                                        ₹{Math.abs(calculatedNet).toFixed(2)}
                                      </span>
                                    </div>
                                  </div>

                                  {/* Action Buttons */}
                                  {!report.isSettled ? (
                                    <button
                                      className={`settlement-btn ${!currentVal || actionLoading || isPrevMonthPending || hasUnverifiedItems ? 'btn-disabled' : 'btn-active'}`}
                                      disabled={!currentVal || actionLoading || isPrevMonthPending || hasUnverifiedItems}
                                      onClick={() => {
                                        setSettlementModalData({
                                          report,
                                          numericSalary,
                                          calculatedNet,
                                          supervisorId: selectedAdminSup.id,
                                          supervisorName: selectedAdminSup.name
                                        });
                                      }}
                                    >
                                      {isPrevMonthPending ? (
                                        <>🔒 Previous Month Pending</>
                                      ) : hasUnverifiedItems ? (
                                        <>⚠️ Verify All Items to Settle</>
                                      ) : (
                                        <>✓ Mark as Settled</>
                                      )}
                                    </button>
                                  ) : (
                                    <button
                                      className="settlement-btn btn-unsettle"
                                      disabled={actionLoading}
                                      onClick={() => {
                                        setConfirmModal({
                                          message: `Unsettle ${report.month}?\n\nThis will delete the settlement record and make this month active again.`,
                                          isDanger: true,
                                          confirmText: 'Unsettle',
                                          onConfirm: async () => {
                                            setConfirmModal(null);
                                            setActionLoading(true);
                                            try {
                                              const res = await apiFetch('/api/settlements/unsettle', {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json' },
                                                body: JSON.stringify({
                                                  supervisor_id: selectedAdminSup.id,
                                                  month: report.month
                                                })
                                              });
                                              if (res.ok) {
                                                triggerNotification('success', `Unsettled ${report.month}!`);
                                                await fetchSettlements();
                                              } else {
                                                triggerNotification('error', 'Failed to revert settlement.');
                                              }
                                            } catch (err) {
                                              triggerNotification('error', 'Connection error.');
                                            } finally {
                                              setActionLoading(false);
                                            }
                                          }
                                        });
                                      }}
                                    >
                                      🔄 Unsettle (Revert to Pending)
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: MANAGE SUPERVISORS CRUD */}
          {activeTab === 'supervisors' && (
            <div className="admin-layout">

              {/* List of supervisors */}
              <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '0.7rem' }}>
                <h3>Supervisor Accounts</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {supervisors.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>No supervisors added yet.</p>
                  ) : (
                    supervisors.map(s => (
                      <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.4rem 0', borderBottom: '1px solid var(--border-color)' }}>
                        <span style={{ fontWeight: '600' }}>{s.name}</span>
                        {editingSupervisorPinId === s.id ? (
                          <div style={{ display: 'flex', gap: '0.4rem' }}>
                            <input
                              type="password"
                              className="form-control mono btn-sm"
                              placeholder="New PIN"
                              maxLength="4"
                              pattern="[0-9]{4}"
                              inputMode="numeric"
                              value={newSupervisorPinForEdit}
                              onChange={(e) => setNewSupervisorPinForEdit(e.target.value)}
                              style={{ width: '80px', padding: '0.2rem 0.4rem', fontSize: '12px' }}
                            />
                            <button
                              className="btn btn-primary btn-sm"
                              style={{ padding: '0.2rem 0.4rem', fontSize: '12px' }}
                              onClick={() => handleEditSupervisorPin(s.id)}
                            >
                              Save
                            </button>
                            <button
                              className="btn btn-outline btn-sm"
                              style={{ padding: '0.2rem 0.4rem', fontSize: '12px' }}
                              onClick={() => {
                                setEditingSupervisorPinId(null);
                                setNewSupervisorPinForEdit('');
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: '0.4rem' }}>
                            <button
                              className="btn btn-outline btn-sm"
                              style={{ padding: '0.2rem 0.4rem', fontSize: '12px' }}
                              onClick={() => {
                                setEditingSupervisorPinId(s.id);
                                setNewSupervisorPinForEdit('');
                              }}
                            >
                              Edit PIN
                            </button>
                            <button
                              className="btn btn-danger btn-sm"
                              style={{ padding: '0.2rem 0.4rem', fontSize: '12px' }}
                              onClick={() => handleDeleteSupervisor(s.id, s.name)}
                            >
                              Remove
                            </button>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Add supervisor form */}
              <form onSubmit={handleAddSupervisor} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', alignSelf: 'start', padding: '0.7rem' }}>
                <h3>Create Account</h3>

                <div className="form-group">
                  <label className="form-label">Full Name</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="E.g., Amit Singh"
                    value={newSupName}
                    onChange={(e) => setNewSupName(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Set Login PIN (4 digits)</label>
                  <input
                    type="password"
                    className="form-control mono"
                    placeholder="1234"
                    maxLength="4"
                    pattern="[0-9]{4}"
                    inputMode="numeric"
                    value={newSupPin}
                    onChange={(e) => setNewSupPin(e.target.value)}
                    required
                  />
                </div>

                <button type="submit" className="btn btn-primary" disabled={actionLoading}>
                  Add Supervisor
                </button>
              </form>

            </div>
          )}

          {activeTab === 'labourers' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '600px' }}>
              <div className="card" style={{ padding: '0.85rem' }}>
                <h3 style={{ fontSize: '15px', marginBottom: '0.75rem' }}>Daily Wage Labourers Registry</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: '-0.5rem', marginBottom: '1rem' }}>
                  Register labourers here. These names will populate on site supervisor portal dropdowns to keep spellings uniform.
                </p>

                {/* Add labourer form */}
                <form onSubmit={handleAddLabourer} style={{ display: 'flex', gap: '0.35rem', marginBottom: '1rem' }}>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="E.g., Amit Kumar"
                    value={newLabourerName}
                    onChange={(e) => setNewLabourerName(e.target.value)}
                    required
                    style={{ fontSize: '13px', padding: '0.35rem' }}
                  />
                  <button type="submit" className="btn btn-primary" disabled={actionLoading} style={{ padding: '0.35rem 0.6rem', fontSize: '12px', width: 'auto' }}>
                    Add Labourer
                  </button>
                </form>

                {/* List of labourers */}
                <div style={{ maxHeight: '400px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {labourers.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center', padding: '1rem' }}>No labourers registered yet.</p>
                  ) : (
                    labourers.map(l => (
                      <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.4rem 0.25rem', borderBottom: '1px solid var(--border-color)', fontSize: '13px' }}>
                        <span>{l.name}</span>
                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          style={{ padding: '0.1rem 0.3rem', fontSize: '11px', color: 'var(--color-danger)', borderColor: 'var(--color-danger)', width: 'auto' }}
                          onClick={() => handleDeleteLabourer(l.id, l.name)}
                        >
                          Remove
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* 2. LABOURER LOOKUP & RECONCILIATION */}
              <div className="card" style={{ padding: '0.85rem' }}>
                <h3 style={{ fontSize: '15px', marginBottom: '0.75rem' }}>Labourer Payment Lookup & Reconciliation</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: '-0.5rem', marginBottom: '1rem' }}>
                  Select a daily wage worker below to view all payouts made to them across all site supervisors.
                </p>

                <div className="form-group" style={{ marginBottom: '1rem', maxWidth: '350px' }}>
                  <select
                    className="form-control"
                    value={selectedLookupLabourerId}
                    onChange={(e) => {
                      setSelectedLookupLabourerId(e.target.value);
                      setLookupOtherSearch('');
                    }}
                    style={{ fontSize: '13px', padding: '0.35rem' }}
                  >
                    <option value="">-- Select Worker --</option>
                    {labourers.map(l => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                    <option value="other">Other Labours</option>
                  </select>
                </div>

                {selectedLookupLabourerId === 'other' && (
                  <div className="form-group" style={{ marginBottom: '1rem', maxWidth: '350px' }}>
                    <label className="form-label" style={{ fontSize: '10px' }}>SEARCH OTHER NAME</label>
                    <input
                      type="text"
                      className="form-control"
                      placeholder="Type worker name..."
                      value={lookupOtherSearch}
                      onChange={(e) => setLookupOtherSearch(e.target.value)}
                      style={{ fontSize: '13px', padding: '0.35rem' }}
                    />
                  </div>
                )}

                {/* lookup results */}
                {selectedLookupLabourerId ? (() => {
                  const lookupLab = selectedLookupLabourerId === 'other' ? { name: 'Other Labours' } : labourers.find(l => l.id === selectedLookupLabourerId);
                  const workerPayments = expenditureLogs.filter(e => {
                    if (selectedLookupLabourerId === 'other') {
                      return e.type === 'labour' && (!e.labourer_id || e.labourer_id === 'other') &&
                        (!lookupOtherSearch || (e.labourer_name && e.labourer_name.toLowerCase().includes(lookupOtherSearch.toLowerCase())));
                    }
                    return e.labourer_id === selectedLookupLabourerId;
                  });
                  const totalWorkerPaid = workerPayments.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);

                  return (
                    <div>
                      {workerPayments.length === 0 ? (
                        <p style={{ color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', padding: '1rem' }}>
                          No payouts logged to <strong>{lookupLab?.name}</strong> yet.
                        </p>
                      ) : (
                        <div>
                          <div style={{ marginBottom: '0.75rem', padding: '0.5rem 0.75rem', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '13px' }}>
                            Total Paid to {lookupLab?.name}: <strong style={{ color: 'var(--color-orange)' }}>₹{totalWorkerPaid.toFixed(2)}</strong>
                          </div>
                          <div className="table-responsive">
                            <table className="ledger-table exp-table">
                              <thead>
                                <tr>
                                  <th className="col-date">DATE</th>
                                  <th className="col-desc">PAID BY</th>
                                  {selectedLookupLabourerId === 'other' && <th className="col-desc">WORKER NAME</th>}
                                  <th className="col-amount">AMOUNT</th>
                                  <th className="col-desc">REMARKS</th>
                                </tr>
                              </thead>
                              <tbody>
                                {workerPayments.map(p => (
                                  <tr key={p.id}>
                                    <td style={{ whiteSpace: 'nowrap' }}>{formatDate(p.date)}</td>
                                    <td>{p.supervisor_name}</td>
                                    {selectedLookupLabourerId === 'other' && <td>{p.labourer_name}</td>}
                                    <td style={{ textAlign: 'right', fontWeight: 'bold', color: 'var(--color-danger)', whiteSpace: 'nowrap' }}>
                                      ₹{parseFloat(p.amount).toFixed(2)}
                                    </td>
                                    <td>{p.note || '-'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })() : (
                  <p style={{ color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', padding: '1rem' }}>
                    Choose a name from the selector above to display their reconciliation sheet.
                  </p>
                )}
              </div>

            </div>
          )}



        </div>
      )}

      {/* 6. MODAL: FULL PHOTO INSPECTOR OVERLAY */}
      {selectedPhoto && (
        <div className="modal-overlay" onClick={() => setSelectedPhoto(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '95vh', width: 'auto', background: 'transparent', border: 'none', position: 'relative' }}>
            <button className="modal-close" style={{ color: '#ffffff', fontSize: '2.5rem', right: '0.5rem', top: '0.5rem', position: 'absolute', zIndex: 10, background: 'rgba(0,0,0,0.5)', borderRadius: '50%', width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setSelectedPhoto(null)}>
              ✕
            </button>
            <img
              src={selectedPhoto}
              alt="Receipt Chit Full"
              style={{
                maxWidth: '100%',
                maxHeight: '80vh',
                objectFit: 'contain',
                borderRadius: '4px',
                boxShadow: '0 10px 30px rgba(0,0,0,0.5)'
              }}
            />
          </div>
        </div>
      )}

      {/* 7. MODAL: SETTLEMENT CONFIRMATION MODAL */}
      {settlementModalData && (
        <div className="modal-overlay" onClick={() => !actionLoading && setSettlementModalData(null)}>
          <div 
            className="modal-content" 
            onClick={(e) => e.stopPropagation()} 
            style={{
              maxWidth: '460px',
              padding: '1.5rem',
              backgroundColor: '#1e242b',
              borderTop: settlementModalData.calculatedNet < 0 ? '4px solid #fa5252' : (settlementModalData.calculatedNet > 0 ? '4px solid #40c057' : '4px solid #339af0'),
              boxShadow: '0 20px 40px rgba(0,0,0,0.6)'
            }}
          >
            <button 
              className="modal-close" 
              onClick={() => !actionLoading && setSettlementModalData(null)}
              disabled={actionLoading}
              style={{ color: 'var(--text-muted)' }}
            >
              ✕
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', marginBottom: '1rem' }}>
              <div style={{
                width: '42px',
                height: '42px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.25rem',
                backgroundColor: settlementModalData.calculatedNet < 0 ? 'rgba(250, 82, 82, 0.15)' : (settlementModalData.calculatedNet > 0 ? 'rgba(64, 192, 87, 0.15)' : 'rgba(51, 154, 240, 0.15)'),
                color: settlementModalData.calculatedNet < 0 ? '#fa5252' : (settlementModalData.calculatedNet > 0 ? '#40c057' : '#339af0')
              }}>
                {settlementModalData.calculatedNet < 0 ? '⚠️' : (settlementModalData.calculatedNet > 0 ? 'ℹ️' : '✓')}
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 'bold', color: '#ffffff' }}>
                  {settlementModalData.calculatedNet < 0 ? 'Company Owes Supervisor' : (settlementModalData.calculatedNet > 0 ? 'Excess Cash Carryforward' : 'Confirm Settlement')}
                </h3>
                <span style={{ fontSize: '0.8rem', color: '#a0aec0' }}>
                  {settlementModalData.report.month} • {settlementModalData.supervisorName}
                </span>
              </div>
            </div>

            <div style={{
              backgroundColor: 'rgba(0,0,0,0.25)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '8px',
              padding: '1rem',
              marginBottom: '1rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.6rem'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem' }}>
                <span style={{ color: '#a0aec0' }}>In Hand Cash:</span>
                <span style={{ fontWeight: 'bold', color: '#e2e8f0' }}>₹{settlementModalData.report.cashLeft.toFixed(2)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.88rem' }}>
                <span style={{ color: '#a0aec0' }}>Monthly Salary:</span>
                <span style={{ fontWeight: 'bold', color: '#e2e8f0' }}>₹{settlementModalData.numericSalary.toFixed(2)}</span>
              </div>
              <div style={{ borderTop: '1px dashed rgba(255,255,255,0.15)', paddingTop: '0.6rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.9rem', fontWeight: '500', color: '#ffffff' }}>
                  {settlementModalData.calculatedNet < 0 ? 'Company Owes:' : (settlementModalData.calculatedNet > 0 ? 'Excess Cash:' : 'Net Balance:')}
                </span>
                <span style={{
                  fontSize: '1.2rem',
                  fontWeight: 'bold',
                  color: settlementModalData.calculatedNet < 0 ? '#fa5252' : (settlementModalData.calculatedNet > 0 ? '#40c057' : '#339af0')
                }}>
                  ₹{Math.abs(settlementModalData.calculatedNet).toFixed(2)}
                </span>
              </div>
            </div>

            <p style={{ fontSize: '0.82rem', color: '#a0aec0', margin: '0 0 1.25rem 0', lineHeight: 1.45 }}>
              {settlementModalData.calculatedNet < 0 
                ? `The company owes ₹${Math.abs(settlementModalData.calculatedNet).toFixed(2)} for ${settlementModalData.report.month}. Next month's opening balance will start clean at ₹0.00.`
                : (settlementModalData.calculatedNet > 0 
                    ? `The excess cash of ₹${settlementModalData.calculatedNet.toFixed(2)} will automatically carry forward into next month's opening income.`
                    : `This month will be marked as fully settled with ₹0.00 balance.`)
              }
            </p>

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button 
                className="btn btn-secondary btn-sm" 
                onClick={() => setSettlementModalData(null)}
                disabled={actionLoading}
                style={{ padding: '0.65rem 1.25rem', minHeight: '44px' }}
              >
                Cancel
              </button>
              <button 
                className="btn btn-primary btn-sm" 
                disabled={actionLoading}
                onClick={() => executeSettlement(settlementModalData)}
                style={{ padding: '0.65rem 1.25rem', minHeight: '44px' }}
              >
                {actionLoading ? 'Processing...' : 'Confirm & Mark Settled'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 8. GENERIC CONFIRM MODAL */}
      {confirmModal && (
        <div className="modal-overlay" onClick={() => !actionLoading && setConfirmModal(null)}>
          <div 
            className="modal-content" 
            onClick={(e) => e.stopPropagation()} 
            style={{ maxWidth: '400px', padding: '1.5rem', backgroundColor: '#1e242b', borderTop: confirmModal.isDanger ? '4px solid #fa5252' : '4px solid #e8590c', boxShadow: '0 20px 40px rgba(0,0,0,0.6)' }}
          >
            <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', fontWeight: 'bold', color: '#ffffff', whiteSpace: 'pre-wrap' }}>
              {confirmModal.message}
            </h3>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => setConfirmModal(null)} disabled={actionLoading} style={{ padding: '0.65rem 1.25rem', minHeight: '44px' }}>Cancel</button>
              <button className={`btn ${confirmModal.isDanger ? 'btn-danger' : 'btn-primary'} btn-sm`} onClick={confirmModal.onConfirm} disabled={actionLoading} style={{ padding: '0.65rem 1.25rem', minHeight: '44px' }}>
                {actionLoading ? 'Processing...' : (confirmModal.confirmText || 'Confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
