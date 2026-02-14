// Firebase Kanban Integration
import { auth, db } from './firebase-config.js';
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signOut 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  where,
  orderBy,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

class FirebaseKanban {
  constructor() {
    this.userId = null;
    this.unsubscribe = null;
  }

  // Authentication
  async signup(email, password) {
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      this.userId = userCredential.user.uid;
      return userCredential.user;
    } catch (error) {
      console.error("Signup error:", error);
      throw error;
    }
  }

  async login(email, password) {
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      this.userId = userCredential.user.uid;
      return userCredential.user;
    } catch (error) {
      console.error("Login error:", error);
      throw error;
    }
  }

  async logout() {
    try {
      await signOut(auth);
      this.userId = null;
      if (this.unsubscribe) this.unsubscribe();
    } catch (error) {
      console.error("Logout error:", error);
      throw error;
    }
  }

  // Task Management
  async addTask(task) {
    if (!this.userId) throw new Error("User not authenticated");
    
    try {
      const docRef = await addDoc(collection(db, "tasks"), {
        ...task,
        userId: this.userId,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      return docRef.id;
    } catch (error) {
      console.error("Error adding task:", error);
      throw error;
    }
  }

  async updateTask(taskId, updates) {
    if (!this.userId) throw new Error("User not authenticated");
    
    try {
      await updateDoc(doc(db, "tasks", taskId), {
        ...updates,
        updatedAt: new Date()
      });
    } catch (error) {
      console.error("Error updating task:", error);
      throw error;
    }
  }

  async deleteTask(taskId) {
    if (!this.userId) throw new Error("User not authenticated");
    
    try {
      await deleteDoc(doc(db, "tasks", taskId));
    } catch (error) {
      console.error("Error deleting task:", error);
      throw error;
    }
  }

  // Real-time sync
  onTasksChange(callback) {
    if (!this.userId) throw new Error("User not authenticated");
    
    const q = query(
      collection(db, "tasks"),
      where("userId", "==", this.userId),
      orderBy("createdAt", "desc")
    );

    this.unsubscribe = onSnapshot(q, (snapshot) => {
      const tasks = [];
      snapshot.forEach((doc) => {
        tasks.push({ id: doc.id, ...doc.data() });
      });
      callback(tasks);
    });

    return this.unsubscribe;
  }
}

export default new FirebaseKanban();
