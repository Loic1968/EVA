(function(){
  var t=localStorage.getItem('eva_theme');
  if(t==='light')document.documentElement.classList.remove('dark');
  else document.documentElement.classList.add('dark');
  var a=localStorage.getItem('eva_accent_color');
  var valid=['blue','red','purple','green','orange','pink'];
  document.documentElement.setAttribute('data-eva-accent',valid.indexOf(a)>=0?a:'blue');
})();
