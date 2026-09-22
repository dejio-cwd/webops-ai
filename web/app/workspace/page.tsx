"use client";
import { useRouter } from "next/navigation";

export default function WorkspacePage() {
  const router = useRouter();
  async function signOut() { await fetch("/api/auth/logout", { method: "POST" }); router.replace("/sign-in"); router.refresh(); }
  return <main style={{minHeight:"100vh",padding:32,background:"#070b15",color:"#eef2ff"}}><header style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><div><small>WEBOPS INTELLIGENCE</small><h1>Command Center</h1></div><button onClick={signOut}>Sign out</button></header><section style={{marginTop:30,padding:36,border:"1px solid #27314b",borderRadius:20,background:"#11182a"}}><small>PHASE 1 · SECURE FOUNDATION</small><h2>Premium workspace is online.</h2><p>Authentication, protected sessions, security controls, and the new application entry point are active.</p><div style={{display:"flex",gap:10}}><button onClick={()=>router.push("/")}>Run audit</button><button onClick={()=>router.push("/onboarding")}>Workspace setup</button></div></section></main>;
}
