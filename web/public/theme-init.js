(function(){
  var t=localStorage.getItem('eva_theme');
  if(t==='light')document.documentElement.classList.remove('dark');
  else document.documentElement.classList.add('dark');
})();
