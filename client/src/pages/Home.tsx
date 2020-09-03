import { IonContent, IonHeader, IonPage, IonTitle, IonToolbar, IonButton } from '@ionic/react';
import React, {useEffect} from 'react';
import {useLocation } from 'react-router-dom';
import './Home.css';

const Home: React.FC<{isAuth: boolean}> = ({isAuth}) => {
  const location = useLocation();
  console.log(location);
  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>{isAuth ? 'Logged In' : 'Not Logged In'}</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent fullscreen>
        <IonHeader collapse="condense">
          <IonToolbar>
            <IonTitle size="large">{isAuth ? 'Logged In' : 'Not Logged In'}</IonTitle>
          </IonToolbar>
        </IonHeader>
        TEST 
        {isAuth ? 'HELLO LOGGED IN USER' : (
          <IonButton routerLink='/login'>
            LOGIN HERE! 
          </IonButton>
        )}
      </IonContent>
    </IonPage>
  );
};

export default Home;
