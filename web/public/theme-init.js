(function(){
  var t=localStorage.getItem('eva_theme');
  if(t==='light')document.documentElement.classList.remove('dark');
  else document.documentElement.classList.add('dark');
  var a=localStorage.getItem('eva_accent_color');
  document.documentElement.setAttribute('data-eva-accent',a==='red'?'red':'blue');
})();
