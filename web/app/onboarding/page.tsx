import Link from "next/link";

export default function OnboardingPage() {
  return <main style={{minHeight:"100vh",display:"grid",placeItems:"center",padding:24,background:"#070b15",color:"#eef2ff"}}><section style={{maxWidth:720,padding:40,border:"1px solid #27314b",borderRadius:20,background:"#11182a"}}><p>WEBOPS AI · FOUNDATION SETUP</p><h1>Secure workspace onboarding</h1><p>Identity protection is active. Organization and project provisioning is the next foundation increment.</p><Link href="/workspace">Continue to Command Center</Link></section></main>;
}
