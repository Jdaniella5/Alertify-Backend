import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../config/firebase.js';

// Get alert history for a specific alert
export async function getAlertHistory(alertId) {
  try {
    const historyRef = collection(db, "alertHistory");
    const q = query(
      historyRef,
      where("alertId", "==", alertId),
      orderBy("timestamp", "desc"),
      limit(10)
    );

    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      timestamp: doc.data().timestamp?.toDate()
    }));
  } catch (error) {
    console.error("Error fetching alert history:", error);
    return [];
  }
}

// Get all alert history with optional filters
export async function getAllAlertHistory({ oracle, asset, limit: resultLimit = 50 } = {}) {
  try {
    const historyRef = collection(db, "alertHistory");
    let q = query(historyRef, orderBy("timestamp", "desc"));
    
    if (oracle) {
      q = query(q, where("oracle", "==", oracle));
    }
    if (asset) {
      q = query(q, where("asset", "==", asset, alert.asset?.toLowerCase() || "unkown"));
    }
    q = query(q, limit(resultLimit));

    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      timestamp: doc.data().timestamp?.toDate()
    }));
  } catch (error) {
    console.error("Error fetching all alert history:", error);
    return [];
  }
}